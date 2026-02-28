"""
Magic Cache Node - 通用缓存优化节点 (TeaCache + FBCache)
Magic Cache 节点 - Universal cache optimization node (TeaCache + FBCache), 
fully self-contained and independent from original source files.
"""

import math
import torch
import contextlib
import dataclasses
import unittest
import inspect
from collections import defaultdict
from typing import Optional, DefaultDict, Dict
from unittest.mock import patch

import comfy.ldm.common_dit
import comfy.model_management as mm

from torch import Tensor
from einops import repeat

from comfy.ldm.flux.layers import timestep_embedding, apply_mod
from comfy.ldm.lightricks.symmetric_patchifier import latent_to_pixel_coords
from comfy.ldm.wan.model import sinusoidal_embedding_1d

# ==================== TeaCache 相关代码 ====================

SUPPORTED_MODELS_COEFFICIENTS = {
    "flux": [4.98651651e+02, -2.83781631e+02, 5.58554382e+01, -3.82021401e+00, 2.64230861e-01],
    "flux-kontext": [-1.04655119e+03, 3.12563399e+02, -1.69500694e+01, 4.10995971e-01, 3.74537863e-02],
    "flux-klein-9b": [4.98651651e+02, -2.83781631e+02, 5.58554382e+01, -3.82021401e+00, 2.64230861e-01],
    "flux-klein-4b": [4.98651651e+02, -2.83781631e+02, 5.58554382e+01, -3.82021401e+00, 2.64230861e-01],
    "flux-klein-9b-sdnq": [4.98651651e+02, -2.83781631e+02, 5.58554382e+01, -3.82021401e+00, 2.64230861e-01],
    "flux-klein-4b-sdnq": [4.98651651e+02, -2.83781631e+02, 5.58554382e+01, -3.82021401e+00, 2.64230861e-01],
    "anima": [4.98651651e+02, -2.83781631e+02, 5.58554382e+01, -3.82021401e+00, 2.64230861e-01],
    "ltxv": [2.14700694e+01, -1.28016453e+01, 2.31279151e+00, 7.92487521e-01, 9.69274326e-03],
    "lumina_2": [-8.74643948e+02, 4.66059906e+02, -7.51559762e+01, 5.32836175e+00, -3.27258296e-02],
    "hunyuan_video": [7.33226126e+02, -4.01131952e+02, 6.75869174e+01, -3.14987800e+00, 9.61237896e-02],
    "hidream_i1_full": [-3.13605009e+04, -7.12425503e+02, 4.91363285e+01, 8.26515490e+00, 1.08053901e-01],
    "hidream_i1_dev": [1.39997273, -4.30130469, 5.01534416, -2.20504164, 0.93942874],
    "hidream_i1_fast": [2.26509623, -6.88864563, 7.61123826, -3.10849353, 0.99927602],
    "wan2.1_t2v_1.3B": [2.39676752e+03, -1.31110545e+03, 2.01331979e+02, -8.29855975e+00, 1.37887774e-01],
    "wan2.1_t2v_14B": [-5784.54975374, 5449.50911966, -1811.16591783, 256.27178429, -13.02252404],
    "wan2.1_i2v_480p_14B": [-3.02331670e+02, 2.23948934e+02, -5.25463970e+01, 5.87348440e+00, -2.01973289e-01],
    "wan2.1_i2v_720p_14B": [-114.36346466, 65.26524496, -18.82220707, 4.91518089, -0.23412683],
    "wan2.1_t2v_1.3B_ret_mode": [-5.21862437e+04, 9.23041404e+03, -5.28275948e+02, 1.36987616e+01, -4.99875664e-02],
    "wan2.1_t2v_14B_ret_mode": [-3.03318725e+05, 4.90537029e+04, -2.65530556e+03, 5.87365115e+01, -3.15583525e-01],
    "wan2.1_i2v_480p_14B_ret_mode": [2.57151496e+05, -3.54229917e+04, 1.40286849e+03, -1.35890334e+01, 1.32517977e-01],
    "wan2.1_i2v_720p_14B_ret_mode": [8.10705460e+03, 2.13393892e+03, -3.72934672e+02, 1.66203073e+01, -4.17769401e-02],
    # Traditional UNet models (approximate identity mapping; usable defaults)
    # NOTE: These coefficients are a conservative fallback; they still enable TeaCache-style gating on UNet.
    "sdxl": [0.0, 0.0, 0.0, 1.0, 0.0],  # y = x
    "sd15": [0.0, 0.0, 0.0, 1.0, 0.0],  # y = x
}

def poly1d(coefficients, x):
    result = torch.zeros_like(x)
    for i, coeff in enumerate(coefficients):
        result += coeff * (x ** (len(coefficients) - 1 - i))
    return result

# TeaCache forward functions (简化版，只包含主要模型)
def teacache_flux_forward(
        self,
        *args,
        **kwargs
    ) -> Tensor:
    # Handle both Flux signature (img, img_ids, txt, txt_ids, timesteps, y, ...) 
    # and ComfyUI standard signature (xc, t, context=..., control=..., transformer_options=..., ...)
    
    # First, detect calling convention by checking args length and kwargs
    # Flux typically has 6+ positional args, ComfyUI standard has 2 (xc, t)
    is_comfyui_standard = (
        len(args) < 6 and 
        (kwargs.get('context') is not None or kwargs.get('transformer_options') is not None or 
         kwargs.get('control') is not None)
    )
    
    # If this looks like ComfyUI standard format, try to use _forward or forward_orig
    if is_comfyui_standard:
        # First, try to use _forward if it exists (this is the ComfyUI internal method that handles conversion)
        if hasattr(self, '_forward'):
            try:
                return self._forward(*args, **kwargs)
            except Exception:
                pass
        
        # If _forward doesn't exist or fails, try forward_orig
        if hasattr(self, 'forward_orig'):
            try:
                # Try to call forward_orig with the arguments as-is
                # This handles the case where forward_orig expects ComfyUI standard format
                return self.forward_orig(*args, **kwargs)
            except Exception:
                # If direct call fails, try to inspect signature and match parameters
                try:
                    sig = inspect.signature(self.forward_orig)
                    param_names = list(sig.parameters.keys())
                    
                    # Check if this looks like ComfyUI standard signature (xc, t, ...)
                    is_standard_signature = (
                        len(param_names) >= 2 and 
                        (param_names[0] in ['xc', 'x'] and param_names[1] in ['t', 'timestep', 'timesteps'])
                    )
                    
                    if is_standard_signature:
                        # ComfyUI standard signature - pass xc, t as positional args
                        xc = args[0] if len(args) > 0 else kwargs.get('xc')
                        t = args[1] if len(args) > 1 else kwargs.get('t')
                        # Filter kwargs to only include parameters that forward_orig accepts
                        forward_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters}
                        return self.forward_orig(xc, t, **forward_kwargs)
                    else:
                        # forward_orig expects Flux format - we need to convert
                        # Try to use _forward if available, otherwise we'll fall through to Flux path
                        if hasattr(self, '_forward'):
                            return self._forward(*args, **kwargs)
                        # If _forward is not available, we'll need to handle conversion ourselves
                        # But for now, let's fall through to the Flux path which will handle it
                        pass
                except Exception:
                    # If all else fails, try direct call one more time
                    try:
                        return self.forward_orig(*args, **kwargs)
                    except Exception:
                        pass
    
    # Flux calling convention - extract parameters
    if len(args) >= 6:
        img, img_ids, txt, txt_ids, timesteps, y = args[0], args[1], args[2], args[3], args[4], args[5]
        if len(args) > 6:
            guidance = args[6]
        else:
            guidance = kwargs.get('guidance')
    else:
        # Try to get from kwargs
        img = kwargs.get('img')
        img_ids = kwargs.get('img_ids')
        txt = kwargs.get('txt')
        txt_ids = kwargs.get('txt_ids')
        timesteps = kwargs.get('timesteps')
        y = kwargs.get('y')
        guidance = kwargs.get('guidance')
    
    # Validate that we have required parameters for Flux path
    if img is None or txt is None or timesteps is None:
        # Missing required parameters - if we have forward_orig, try to use it
        if hasattr(self, 'forward_orig'):
            # Try to call forward_orig with available args/kwargs
            try:
                return self.forward_orig(*args, **kwargs)
            except Exception:
                # If direct call fails, try signature-based approach
                try:
                    sig = inspect.signature(self.forward_orig)
                    param_names = list(sig.parameters.keys())
                    
                    # Check if this looks like ComfyUI standard signature
                    is_standard_signature = (
                        len(param_names) >= 2 and 
                        (param_names[0] in ['xc', 'x'] and param_names[1] in ['t', 'timestep', 'timesteps'])
                    )
                    
                    if is_standard_signature:
                        # ComfyUI standard signature - pass xc, t as positional args
                        xc = args[0] if len(args) > 0 else kwargs.get('xc')
                        t = args[1] if len(args) > 1 else kwargs.get('t')
                        forward_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters}
                        return self.forward_orig(xc, t, **forward_kwargs)
                    else:
                        # Try to pass args as positional if they match
                        forward_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters}
                        if len(args) >= len(param_names):
                            return self.forward_orig(*args[:len(param_names)], **forward_kwargs)
                        elif len(args) > 0:
                            return self.forward_orig(*args, **forward_kwargs)
                        else:
                            return self.forward_orig(**forward_kwargs)
                except Exception as e:
                    # If all else fails, raise a more informative error
                    raise ValueError(f"teacache_flux_forward() cannot handle this call signature. Args: {len(args)}, Kwargs keys: {list(kwargs.keys())}. Original error: {e}")
        else:
            raise ValueError(f"teacache_flux_forward() missing required arguments: img={img is not None}, txt={txt is not None}, timesteps={timesteps is not None}, and no forward_orig available")
    
    control = kwargs.get('control')
    transformer_options = kwargs.get('transformer_options', {})
    attn_mask = kwargs.get('attn_mask')
    context = kwargs.get('context')
    
    patches_replace = transformer_options.get("patches_replace", {})
    rel_l1_thresh = transformer_options.get("rel_l1_thresh")
    coefficients = transformer_options.get("coefficients")
    enable_teacache = transformer_options.get("enable_teacache", True)
    cache_device = transformer_options.get("cache_device")

    vec_in_dim = getattr(self.params, 'vec_in_dim', None)
    if vec_in_dim is None and hasattr(self, 'vector_in'):
        if hasattr(self.vector_in, 'in_features'):
            vec_in_dim = self.vector_in.in_features
        elif hasattr(self.vector_in, 'weight') and self.vector_in.weight is not None:
            vec_in_dim = self.vector_in.weight.shape[-1]
    
    if y is not None and vec_in_dim is None and y.shape[-1] > 0:
        vec_in_dim = y.shape[-1]

    if y is None:
        if vec_in_dim is None:
            vec_in_dim = 0
        y = torch.zeros((img.shape[0], vec_in_dim), device=img.device, dtype=img.dtype)
        
    if img.ndim != 3 or txt.ndim != 3:
        raise ValueError("Input img and txt tensors must have 3 dimensions.")

    img = self.img_in(img)
    vec = self.time_in(timestep_embedding(timesteps, 256).to(img.dtype))
    if self.params.guidance_embed:
        if guidance is not None:
            vec = vec + self.guidance_in(timestep_embedding(guidance, 256).to(img.dtype))

    if vec_in_dim is not None and vec_in_dim > 0:
        vec = vec + self.vector_in(y[:,:vec_in_dim])
    elif y is not None and y.shape[-1] > 0:
        vec = vec + self.vector_in(y)
    txt = self.txt_in(txt)

    vec_orig = vec
    if getattr(self.params, 'global_modulation', False):
        vec = (self.double_stream_modulation_img(vec_orig), self.double_stream_modulation_txt(vec_orig))

    if img_ids is not None:
        ids = torch.cat((txt_ids, img_ids), dim=1)
        pe = self.pe_embedder(ids)
    else:
        pe = None

    blocks_replace = patches_replace.get("dit", {})

    # enable teacache
    # Check if modulation is enabled (img_mod exists)
    has_modulation = hasattr(self.double_blocks[0], 'img_mod') and self.double_blocks[0].modulation
    global_modulation = getattr(self.params, 'global_modulation', False)
    if has_modulation and not global_modulation:
        img_mod1, _ = self.double_blocks[0].img_mod(vec)
        modulated_inp = self.double_blocks[0].img_norm1(img)
        modulated_inp = apply_mod(modulated_inp, (1 + img_mod1.scale), img_mod1.shift).to(cache_device)
    elif global_modulation:
        img_mod1, _ = vec[0]
        modulated_inp = self.double_blocks[0].img_norm1(img)
        modulated_inp = apply_mod(modulated_inp, (1 + img_mod1.scale), img_mod1.shift).to(cache_device)
    else:
        modulated_inp = self.double_blocks[0].img_norm1(img).to(cache_device)
    ca_idx = 0

    if not hasattr(self, 'accumulated_rel_l1_distance'):
        should_calc = True
        self.accumulated_rel_l1_distance = 0
    else:
        try:
            self.accumulated_rel_l1_distance += poly1d(coefficients, ((modulated_inp-self.previous_modulated_input).abs().mean() / self.previous_modulated_input.abs().mean())).abs()
            if self.accumulated_rel_l1_distance < rel_l1_thresh:
                should_calc = False
            else:
                should_calc = True
                self.accumulated_rel_l1_distance = 0
        except:
            should_calc = True
            self.accumulated_rel_l1_distance = 0

    self.previous_modulated_input = modulated_inp

    if not enable_teacache:
        should_calc = True

    if not should_calc:
        img += self.previous_residual.to(img.device)
    else:
        ori_img = img.to(cache_device)
        for i, block in enumerate(self.double_blocks):
            if ("double_block", i) in blocks_replace:
                def block_wrap(args):
                    out = {}
                    out["img"], out["txt"] = block(img=args["img"],
                                                txt=args["txt"],
                                                vec=args["vec"],
                                                pe=args["pe"],
                                                attn_mask=args.get("attn_mask"))
                    return out

                out = blocks_replace[("double_block", i)]({"img": img,
                                                        "txt": txt,
                                                        "vec": vec,
                                                        "pe": pe,
                                                        "attn_mask": attn_mask},
                                                        {"original_block": block_wrap})
                txt = out["txt"]
                img = out["img"]
            else:
                img, txt = block(img=img,
                                txt=txt,
                                vec=vec,
                                pe=pe,
                                attn_mask=attn_mask)

            if control is not None:
                control_i = control.get("input")
                if i < len(control_i):
                    add = control_i[i]
                    if add is not None:
                        img += add

            if getattr(self, "pulid_data", {}):
                if i % self.pulid_double_interval == 0:
                    for _, node_data in self.pulid_data.items():
                        if torch.any((node_data['sigma_start'] >= timesteps)
                                    & (timesteps >= node_data['sigma_end'])):
                            img = img + node_data['weight'] * self.pulid_ca[ca_idx](node_data['embedding'], img)
                    ca_idx += 1

        if img.dtype == torch.float16:
            img = torch.nan_to_num(img, nan=0.0, posinf=65504, neginf=-65504)

        img = torch.cat((txt, img), 1)

        if getattr(self.params, 'global_modulation', False):
            vec, _ = self.single_stream_modulation(vec_orig)

        for i, block in enumerate(self.single_blocks):
            if ("single_block", i) in blocks_replace:
                def block_wrap(args):
                    out = {}
                    out["img"] = block(args["img"],
                                    vec=args["vec"],
                                    pe=args["pe"],
                                    attn_mask=args.get("attn_mask"))
                    return out

                out = blocks_replace[("single_block", i)]({"img": img,
                                                        "vec": vec,
                                                        "pe": pe,
                                                        "attn_mask": attn_mask}, 
                                                        {"original_block": block_wrap})
                img = out["img"]
            else:
                img = block(img, vec=vec, pe=pe, attn_mask=attn_mask)

            if control is not None:
                control_o = control.get("output")
                if i < len(control_o):
                    add = control_o[i]
                    if add is not None:
                        img[:, txt.shape[1] :, ...] += add

            if getattr(self, "pulid_data", {}):
                real_img, txt = img[:, txt.shape[1]:, ...], img[:, :txt.shape[1], ...]
                if i % self.pulid_single_interval == 0:
                    for _, node_data in self.pulid_data.items():
                        if torch.any((node_data['sigma_start'] >= timesteps)
                                    & (timesteps >= node_data['sigma_end'])):
                            real_img = real_img + node_data['weight'] * self.pulid_ca[ca_idx](node_data['embedding'], real_img)
                        ca_idx += 1
                    img = torch.cat((txt, real_img), 1)

        img = img[:, txt.shape[1] :, ...]
        self.previous_residual = img.to(cache_device) - ori_img

    img = self.final_layer(img, vec_orig)
    
    return img

# 其他TeaCache forward函数（简化，只包含关键部分）
def teacache_hidream_forward(self, x, t, y=None, context=None, encoder_hidden_states_llama3=None, image_cond=None, control=None, transformer_options={}):
    rel_l1_thresh = transformer_options.get("rel_l1_thresh")
    coefficients = transformer_options.get("coefficients")
    cond_or_uncond = transformer_options.get("cond_or_uncond")
    model_type = transformer_options.get("model_type")
    enable_teacache = transformer_options.get("enable_teacache", True)
    cache_device = transformer_options.get("cache_device")

    bs, c, h, w = x.shape
    if image_cond is not None:
        x = torch.cat([x, image_cond], dim=-1)
    hidden_states = comfy.ldm.common_dit.pad_to_patch_size(x, (self.patch_size, self.patch_size))
    timesteps = t
    pooled_embeds = y
    T5_encoder_hidden_states = context

    img_sizes = None
    batch_size = hidden_states.shape[0]
    hidden_states_type = hidden_states.dtype

    timesteps = self.expand_timesteps(timesteps, batch_size, hidden_states.device)
    timesteps = self.t_embedder(timesteps, hidden_states_type)
    p_embedder = self.p_embedder(pooled_embeds)
    adaln_input = timesteps + p_embedder

    hidden_states, image_tokens_masks, img_sizes = self.patchify(hidden_states, self.max_seq, img_sizes)
    if image_tokens_masks is None:
        pH, pW = img_sizes[0]
        img_ids = torch.zeros(pH, pW, 3, device=hidden_states.device)
        img_ids[..., 1] = img_ids[..., 1] + torch.arange(pH, device=hidden_states.device)[:, None]
        img_ids[..., 2] = img_ids[..., 2] + torch.arange(pW, device=hidden_states.device)[None, :]
        img_ids = repeat(img_ids, "h w c -> b (h w) c", b=batch_size)
    hidden_states = self.x_embedder(hidden_states)

    encoder_hidden_states = encoder_hidden_states_llama3.movedim(1, 0)
    encoder_hidden_states = [encoder_hidden_states[k] for k in self.llama_layers]

    if self.caption_projection is not None:
        new_encoder_hidden_states = []
        for i, enc_hidden_state in enumerate(encoder_hidden_states):
            enc_hidden_state = self.caption_projection[i](enc_hidden_state)
            enc_hidden_state = enc_hidden_state.view(batch_size, -1, hidden_states.shape[-1])
            new_encoder_hidden_states.append(enc_hidden_state)
        encoder_hidden_states = new_encoder_hidden_states
        T5_encoder_hidden_states = self.caption_projection[-1](T5_encoder_hidden_states)
        T5_encoder_hidden_states = T5_encoder_hidden_states.view(batch_size, -1, hidden_states.shape[-1])
        encoder_hidden_states.append(T5_encoder_hidden_states)

    txt_ids = torch.zeros(
        batch_size,
        encoder_hidden_states[-1].shape[1] + encoder_hidden_states[-2].shape[1] + encoder_hidden_states[0].shape[1],
        3,
        device=img_ids.device, dtype=img_ids.dtype
    )
    ids = torch.cat((img_ids, txt_ids), dim=1)
    rope = self.pe_embedder(ids)

    # enable teacache
    modulated_inp = timesteps.to(cache_device) if "full" in model_type else hidden_states.to(cache_device)
    if not hasattr(self, 'teacache_state'):
        self.teacache_state = {
            0: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None},
            1: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None}
        }

    def update_cache_state(cache, modulated_inp):
        if cache['previous_modulated_input'] is not None:
            try:
                cache['accumulated_rel_l1_distance'] += poly1d(coefficients, ((modulated_inp-cache['previous_modulated_input']).abs().mean() / cache['previous_modulated_input'].abs().mean()))
                if cache['accumulated_rel_l1_distance'] < rel_l1_thresh:
                    cache['should_calc'] = False
                else:
                    cache['should_calc'] = True
                    cache['accumulated_rel_l1_distance'] = 0
            except:
                cache['should_calc'] = True
                cache['accumulated_rel_l1_distance'] = 0
        cache['previous_modulated_input'] = modulated_inp
        
    b = int(len(hidden_states) / len(cond_or_uncond))

    for i, k in enumerate(cond_or_uncond):
        update_cache_state(self.teacache_state[k], modulated_inp[i*b:(i+1)*b])

    if enable_teacache:
        should_calc = False
        for k in cond_or_uncond:
            should_calc = (should_calc or self.teacache_state[k]['should_calc'])
    else:
        should_calc = True

    if not should_calc:
        for i, k in enumerate(cond_or_uncond):
            hidden_states[i*b:(i+1)*b] += self.teacache_state[k]['previous_residual'].to(hidden_states.device)
    else:
        ori_hidden_states = hidden_states.to(cache_device)
        block_id = 0
        initial_encoder_hidden_states = torch.cat([encoder_hidden_states[-1], encoder_hidden_states[-2]], dim=1)
        initial_encoder_hidden_states_seq_len = initial_encoder_hidden_states.shape[1]
        for bid, block in enumerate(self.double_stream_blocks):
            cur_llama31_encoder_hidden_states = encoder_hidden_states[block_id]
            cur_encoder_hidden_states = torch.cat([initial_encoder_hidden_states, cur_llama31_encoder_hidden_states], dim=1)
            hidden_states, initial_encoder_hidden_states = block(
                image_tokens = hidden_states,
                image_tokens_masks = image_tokens_masks,
                text_tokens = cur_encoder_hidden_states,
                adaln_input = adaln_input,
                rope = rope,
            )
            initial_encoder_hidden_states = initial_encoder_hidden_states[:, :initial_encoder_hidden_states_seq_len]
            block_id += 1

        image_tokens_seq_len = hidden_states.shape[1]
        hidden_states = torch.cat([hidden_states, initial_encoder_hidden_states], dim=1)
        hidden_states_seq_len = hidden_states.shape[1]
        if image_tokens_masks is not None:
            encoder_attention_mask_ones = torch.ones(
                (batch_size, initial_encoder_hidden_states.shape[1] + cur_llama31_encoder_hidden_states.shape[1]),
                device=image_tokens_masks.device, dtype=image_tokens_masks.dtype
            )
            image_tokens_masks = torch.cat([image_tokens_masks, encoder_attention_mask_ones], dim=1)

        for bid, block in enumerate(self.single_stream_blocks):
            cur_llama31_encoder_hidden_states = encoder_hidden_states[block_id]
            hidden_states = torch.cat([hidden_states, cur_llama31_encoder_hidden_states], dim=1)
            hidden_states = block(
                image_tokens=hidden_states,
                image_tokens_masks=image_tokens_masks,
                text_tokens=None,
                adaln_input=adaln_input,
                rope=rope,
            )
            hidden_states = hidden_states[:, :hidden_states_seq_len]
            block_id += 1

        hidden_states = hidden_states[:, :image_tokens_seq_len, ...]
        for i, k in enumerate(cond_or_uncond):
            self.teacache_state[k]['previous_residual'] = (hidden_states.to(cache_device) - ori_hidden_states)[i*b:(i+1)*b]

    output = self.final_layer(hidden_states, adaln_input)
    output = self.unpatchify(output, img_sizes)
    return -output[:, :, :h, :w]

# 其他模型的forward函数（简化版，只包含关键逻辑）
def teacache_lumina_forward(self, x, timesteps, context, num_tokens, attention_mask=None, transformer_options={}, **kwargs):
    rel_l1_thresh = transformer_options.get("rel_l1_thresh")
    coefficients = transformer_options.get("coefficients")
    cond_or_uncond = transformer_options.get("cond_or_uncond")
    enable_teacache = transformer_options.get("enable_teacache", True)
    cache_device = transformer_options.get("cache_device")

    t = 1.0 - timesteps
    cap_feats = context
    cap_mask = attention_mask
    bs, c, h, w = x.shape
    x = comfy.ldm.common_dit.pad_to_patch_size(x, (self.patch_size, self.patch_size))
    
    t = self.t_embedder(t, dtype=x.dtype)
    adaln_input = t

    cap_feats = self.cap_embedder(cap_feats)

    x_is_tensor = isinstance(x, torch.Tensor)
    x, mask, img_size, cap_size, freqs_cis = self.patchify_and_embed(x, cap_feats, cap_mask, t, num_tokens)
    freqs_cis = freqs_cis.to(x.device)

    # enable teacache
    modulated_inp = t.to(cache_device)
    if not hasattr(self, 'teacache_state'):
        self.teacache_state = {
            0: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None},
            1: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None}
        }

    def update_cache_state(cache, modulated_inp):
        if cache['previous_modulated_input'] is not None:
            try:
                cache['accumulated_rel_l1_distance'] += poly1d(coefficients, ((modulated_inp-cache['previous_modulated_input']).abs().mean() / cache['previous_modulated_input'].abs().mean()))
                if cache['accumulated_rel_l1_distance'] < rel_l1_thresh:
                    cache['should_calc'] = False
                else:
                    cache['should_calc'] = True
                    cache['accumulated_rel_l1_distance'] = 0
            except:
                cache['should_calc'] = True
                cache['accumulated_rel_l1_distance'] = 0
        cache['previous_modulated_input'] = modulated_inp

    b = int(len(x) / len(cond_or_uncond))

    for i, k in enumerate(cond_or_uncond):
        update_cache_state(self.teacache_state[k], modulated_inp[i*b:(i+1)*b])

    if enable_teacache:
        should_calc = False
        for k in cond_or_uncond:
            should_calc = (should_calc or self.teacache_state[k]['should_calc'])
    else:
        should_calc = True

    if not should_calc:
        for i, k in enumerate(cond_or_uncond):
            x[i*b:(i+1)*b] += self.teacache_state[k]['previous_residual'].to(x.device)
    else:
        ori_x = x.to(cache_device)
        for layer in self.layers:
            x = layer(x, mask, freqs_cis, adaln_input)
        for i, k in enumerate(cond_or_uncond):
            self.teacache_state[k]['previous_residual'] = (x.to(cache_device) - ori_x)[i*b:(i+1)*b]
        
    x = self.final_layer(x, adaln_input)
    x = self.unpatchify(x, img_size, cap_size, return_tensor=x_is_tensor)[:,:,:h,:w]

    return -x

def teacache_hunyuanvideo_forward(
        self,
        img: Tensor,
        img_ids: Tensor,
        txt: Tensor,
        txt_ids: Tensor,
        txt_mask: Tensor,
        timesteps: Tensor,
        y: Tensor,
        guidance: Tensor = None,
        guiding_frame_index=None,
        ref_latent=None,
        control=None,
        transformer_options={},
    ) -> Tensor:
    patches_replace = transformer_options.get("patches_replace", {})
    rel_l1_thresh = transformer_options.get("rel_l1_thresh")
    coefficients = transformer_options.get("coefficients")
    enable_teacache = transformer_options.get("enable_teacache", True)
    cache_device = transformer_options.get("cache_device")

    vec_in_dim = getattr(self.params, 'vec_in_dim', None)
    if vec_in_dim is None and hasattr(self, 'vector_in'):
        if hasattr(self.vector_in, 'in_features'):
            vec_in_dim = self.vector_in.in_features
        elif hasattr(self.vector_in, 'weight') and self.vector_in.weight is not None:
            vec_in_dim = self.vector_in.weight.shape[-1]
    
    if y is not None and vec_in_dim is None and y.shape[-1] > 0:
        vec_in_dim = y.shape[-1]

    initial_shape = list(img.shape)
    img = self.img_in(img)
    vec = self.time_in(timestep_embedding(timesteps, 256, time_factor=1.0).to(img.dtype))

    if ref_latent is not None:
        ref_latent_ids = self.img_ids(ref_latent)
        ref_latent = self.img_in(ref_latent)
        img = torch.cat([ref_latent, img], dim=-2)
        ref_latent_ids[..., 0] = -1
        ref_latent_ids[..., 2] += (initial_shape[-1] // self.patch_size[-1])
        img_ids = torch.cat([ref_latent_ids, img_ids], dim=-2)

    if guiding_frame_index is not None:
        token_replace_vec = self.time_in(timestep_embedding(guiding_frame_index, 256, time_factor=1.0))
        if vec_in_dim is not None and vec_in_dim > 0 and y is not None:
            vec_ = self.vector_in(y[:, :vec_in_dim])
        elif y is not None and y.shape[-1] > 0:
            vec_ = self.vector_in(y)
        else:
            if vec_in_dim is not None and vec_in_dim > 0:
                vec_ = self.vector_in(torch.zeros((img.shape[0], vec_in_dim), device=img.device, dtype=img.dtype))
            else:
                vec_ = torch.zeros_like(vec)
        vec = torch.cat([(vec_ + token_replace_vec).unsqueeze(1), (vec_ + vec).unsqueeze(1)], dim=1)
        frame_tokens = (initial_shape[-1] // self.patch_size[-1]) * (initial_shape[-2] // self.patch_size[-2])
        modulation_dims = [(0, frame_tokens, 0), (frame_tokens, None, 1)]
        modulation_dims_txt = [(0, None, 1)]
    else:
        if vec_in_dim is not None and vec_in_dim > 0 and y is not None:
            vec = vec + self.vector_in(y[:, :vec_in_dim])
        elif y is not None and y.shape[-1] > 0:
            vec = vec + self.vector_in(y)
        elif vec_in_dim is not None and vec_in_dim > 0:
            vec = vec + self.vector_in(torch.zeros((img.shape[0], vec_in_dim), device=img.device, dtype=img.dtype))
        modulation_dims = None
        modulation_dims_txt = None

    if self.params.guidance_embed:
        if guidance is not None:
            vec = vec + self.guidance_in(timestep_embedding(guidance, 256).to(img.dtype))

    if txt_mask is not None and not torch.is_floating_point(txt_mask):
        txt_mask = (txt_mask - 1).to(img.dtype) * torch.finfo(img.dtype).max

    txt = self.txt_in(txt, timesteps, txt_mask)

    ids = torch.cat((img_ids, txt_ids), dim=1)
    pe = self.pe_embedder(ids)

    img_len = img.shape[1]
    if txt_mask is not None:
        attn_mask_len = img_len + txt.shape[1]
        attn_mask = torch.zeros((1, 1, attn_mask_len), dtype=img.dtype, device=img.device)
        attn_mask[:, 0, img_len:] = txt_mask
    else:
        attn_mask = None

    blocks_replace = patches_replace.get("dit", {})

    # enable teacache
    # Check if modulation is enabled (img_mod exists)
    has_modulation = hasattr(self.double_blocks[0], 'img_mod') and self.double_blocks[0].modulation
    if has_modulation:
        img_mod1, _ = self.double_blocks[0].img_mod(vec)
        modulated_inp = self.double_blocks[0].img_norm1(img)
        modulated_inp = apply_mod(modulated_inp, (1 + img_mod1.scale), img_mod1.shift, modulation_dims).to(cache_device)
    else:
        modulated_inp = self.double_blocks[0].img_norm1(img).to(cache_device)

    if not hasattr(self, 'accumulated_rel_l1_distance'):
        should_calc = True
        self.accumulated_rel_l1_distance = 0
    else:
        try:
            self.accumulated_rel_l1_distance += poly1d(coefficients, ((modulated_inp-self.previous_modulated_input).abs().mean() / self.previous_modulated_input.abs().mean()))
            if self.accumulated_rel_l1_distance < rel_l1_thresh:
                should_calc = False
            else:
                should_calc = True
                self.accumulated_rel_l1_distance = 0
        except:
            should_calc = True
            self.accumulated_rel_l1_distance = 0

    self.previous_modulated_input = modulated_inp

    if not enable_teacache:
        should_calc = True

    if not should_calc:
        img += self.previous_residual.to(img.device)
    else:
        ori_img = img.to(cache_device)
        for i, block in enumerate(self.double_blocks):
            if ("double_block", i) in blocks_replace:
                def block_wrap(args):
                    out = {}
                    out["img"], out["txt"] = block(img=args["img"], txt=args["txt"], vec=args["vec"], pe=args["pe"], attn_mask=args["attention_mask"], modulation_dims_img=args["modulation_dims_img"], modulation_dims_txt=args["modulation_dims_txt"])
                    return out

                out = blocks_replace[("double_block", i)]({"img": img, "txt": txt, "vec": vec, "pe": pe, "attention_mask": attn_mask, 'modulation_dims_img': modulation_dims, 'modulation_dims_txt': modulation_dims_txt}, {"original_block": block_wrap})
                txt = out["txt"]
                img = out["img"]
            else:
                img, txt = block(img=img, txt=txt, vec=vec, pe=pe, attn_mask=attn_mask, modulation_dims_img=modulation_dims, modulation_dims_txt=modulation_dims_txt)

            if control is not None:
                control_i = control.get("input")
                if i < len(control_i):
                    add = control_i[i]
                    if add is not None:
                        img += add

        img = torch.cat((img, txt), 1)

        for i, block in enumerate(self.single_blocks):
            if ("single_block", i) in blocks_replace:
                def block_wrap(args):
                    out = {}
                    out["img"] = block(args["img"], vec=args["vec"], pe=args["pe"], attn_mask=args["attention_mask"], modulation_dims=args["modulation_dims"])
                    return out

                out = blocks_replace[("single_block", i)]({"img": img, "vec": vec, "pe": pe, "attention_mask": attn_mask, 'modulation_dims': modulation_dims}, {"original_block": block_wrap})
                img = out["img"]
            else:
                img = block(img, vec=vec, pe=pe, attn_mask=attn_mask, modulation_dims=modulation_dims)

            if control is not None:
                control_o = control.get("output")
                if i < len(control_o):
                    add = control_o[i]
                    if add is not None:
                        img[:, : img_len] += add

        img = img[:, : img_len]
        self.previous_residual = (img.to(cache_device) - ori_img)

    if ref_latent is not None:
        img = img[:, ref_latent.shape[1]:]
    
    img = self.final_layer(img, vec, modulation_dims=modulation_dims)

    shape = initial_shape[-3:]
    for i in range(len(shape)):
        shape[i] = shape[i] // self.patch_size[i]
    img = img.reshape([img.shape[0]] + shape + [self.out_channels] + self.patch_size)
    img = img.permute(0, 4, 1, 5, 2, 6, 3, 7)
    img = img.reshape(initial_shape[0], self.out_channels, initial_shape[2], initial_shape[3], initial_shape[4])
    return img

def teacache_ltxvmodel_forward(
        self,
        x,
        timestep,
        context,
        attention_mask,
        frame_rate=25,
        transformer_options={},
        keyframe_idxs=None,
        **kwargs
    ):
    patches_replace = transformer_options.get("patches_replace", {})
    rel_l1_thresh = transformer_options.get("rel_l1_thresh")
    coefficients = transformer_options.get("coefficients")
    cond_or_uncond = transformer_options.get("cond_or_uncond")
    enable_teacache = transformer_options.get("enable_teacache", True)
    cache_device = transformer_options.get("cache_device")

    orig_shape = list(x.shape)

    x, latent_coords = self.patchifier.patchify(x)
    pixel_coords = latent_to_pixel_coords(
        latent_coords=latent_coords,
        scale_factors=self.vae_scale_factors,
        causal_fix=self.causal_temporal_positioning,
    )

    if keyframe_idxs is not None:
        pixel_coords[:, :, -keyframe_idxs.shape[2]:] = keyframe_idxs

    fractional_coords = pixel_coords.to(torch.float32)
    fractional_coords[:, 0] = fractional_coords[:, 0] * (1.0 / frame_rate)

    x = self.patchify_proj(x)
    timestep = timestep * 1000.0

    if attention_mask is not None and not torch.is_floating_point(attention_mask):
        attention_mask = (attention_mask - 1).to(x.dtype).reshape((attention_mask.shape[0], 1, -1, attention_mask.shape[-1])) * torch.finfo(x.dtype).max        

    if len(fractional_coords.shape) == 4:
        B, T, N, D = fractional_coords.shape
        fractional_coords = fractional_coords.reshape(B, T * N, D)
    
    pe = self._precompute_freqs_cis(
        fractional_coords,
        dim=self.inner_dim,
        out_dtype=x.dtype,
        max_pos=self.positional_embedding_max_pos,
        use_middle_indices_grid=self.use_middle_indices_grid,
        num_attention_heads=self.num_attention_heads,
    )

    batch_size = x.shape[0]
    timestep, embedded_timestep = self.adaln_single(
        timestep.flatten(),
        {"resolution": None, "aspect_ratio": None},
        batch_size=batch_size,
        hidden_dtype=x.dtype,
    )
    timestep = timestep.view(batch_size, -1, timestep.shape[-1])
    embedded_timestep = embedded_timestep.view(
        batch_size, -1, embedded_timestep.shape[-1]
    )

    if self.caption_projection is not None:
        batch_size = x.shape[0]
        context = self.caption_projection(context)
        context = context.view(
            batch_size, -1, x.shape[-1]
        )

    blocks_replace = patches_replace.get("dit", {})

    # enable teacache
    inp = x.to(cache_device)
    timestep_ = timestep.to(cache_device)
    num_ada_params = self.transformer_blocks[0].scale_shift_table.shape[0]
    ada_values = self.transformer_blocks[0].scale_shift_table[None, None].to(timestep_.device) + timestep_.reshape(batch_size, timestep_.size(1), num_ada_params, -1)
    shift_msa, scale_msa, _, _, _, _ = ada_values.unbind(dim=2)
    modulated_inp = comfy.ldm.common_dit.rms_norm(inp)
    modulated_inp = modulated_inp * (1 + scale_msa) + shift_msa

    if not hasattr(self, 'teacache_state'):
        self.teacache_state = {
            0: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None},
            1: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None}
        }

    def update_cache_state(cache, modulated_inp):
        if cache['previous_modulated_input'] is not None:
            try:
                cache['accumulated_rel_l1_distance'] += poly1d(coefficients, ((modulated_inp-cache['previous_modulated_input']).abs().mean() / cache['previous_modulated_input'].abs().mean()))
                if cache['accumulated_rel_l1_distance'] < rel_l1_thresh:
                    cache['should_calc'] = False
                else:
                    cache['should_calc'] = True
                    cache['accumulated_rel_l1_distance'] = 0
            except:
                cache['should_calc'] = True
                cache['accumulated_rel_l1_distance'] = 0
        cache['previous_modulated_input'] = modulated_inp

    b = int(len(x) / len(cond_or_uncond))
    
    for i, k in enumerate(cond_or_uncond):
        update_cache_state(self.teacache_state[k], modulated_inp[i*b:(i+1)*b])

    if enable_teacache:
        should_calc = False
        for k in cond_or_uncond:
            should_calc = (should_calc or self.teacache_state[k]['should_calc'])
    else:
        should_calc = True
    
    if not should_calc:
        for i, k in enumerate(cond_or_uncond):
            x[i*b:(i+1)*b] += self.teacache_state[k]['previous_residual'].to(x.device)
    else:
        ori_x = x.to(cache_device)
        for i, block in enumerate(self.transformer_blocks):
            if ("double_block", i) in blocks_replace:
                def block_wrap(args):
                    out = {}
                    out["img"] = block(args["img"], context=args["txt"], attention_mask=args["attention_mask"], timestep=args["vec"], pe=args["pe"])
                    return out

                out = blocks_replace[("double_block", i)]({"img": x, "txt": context, "attention_mask": attention_mask, "vec": timestep, "pe": pe}, {"original_block": block_wrap})
                x = out["img"]
            else:
                x = block(
                    x,
                    context=context,
                    attention_mask=attention_mask,
                    timestep=timestep,
                    pe=pe
                )

        scale_shift_values = (
            self.scale_shift_table[None, None].to(device=x.device, dtype=x.dtype) + embedded_timestep[:, :, None]
        )
        shift, scale = scale_shift_values[:, :, 0], scale_shift_values[:, :, 1]
        x = self.norm_out(x)
        x = x * (1 + scale) + shift
        for i, k in enumerate(cond_or_uncond):
            self.teacache_state[k]['previous_residual'] = (x.to(cache_device) - ori_x)[i*b:(i+1)*b]

    x = self.proj_out(x)

    x = self.patchifier.unpatchify(
        latents=x,
        output_height=orig_shape[3],
        output_width=orig_shape[4],
        output_num_frames=orig_shape[2],
        out_channels=orig_shape[1] // math.prod(self.patchifier.patch_size),
    )

    return x

def teacache_wanmodel_forward(
        self,
        x,
        t,
        context,
        clip_fea=None,
        freqs=None,
        transformer_options={},
        **kwargs,
    ):
    patches_replace = transformer_options.get("patches_replace", {})
    rel_l1_thresh = transformer_options.get("rel_l1_thresh")
    coefficients = transformer_options.get("coefficients")
    cond_or_uncond = transformer_options.get("cond_or_uncond")
    model_type = transformer_options.get("model_type")
    enable_teacache = transformer_options.get("enable_teacache", True)
    cache_device = transformer_options.get("cache_device")

    x = self.patch_embedding(x.float()).to(x.dtype)
    grid_sizes = x.shape[2:]
    x = x.flatten(2).transpose(1, 2)

    e = self.time_embedding(
        sinusoidal_embedding_1d(self.freq_dim, t).to(dtype=x[0].dtype))
    e0 = self.time_projection(e).unflatten(1, (6, self.dim))

    context = self.text_embedding(context)

    context_img_len = None
    if clip_fea is not None:
        if self.img_emb is not None:
            context_clip = self.img_emb(clip_fea)
            context = torch.concat([context_clip, context], dim=1)
        context_img_len = clip_fea.shape[-2]

    blocks_replace = patches_replace.get("dit", {})

    # enable teacache
    modulated_inp = e0.to(cache_device) if "ret_mode" in model_type else e.to(cache_device)
    if not hasattr(self, 'teacache_state'):
        self.teacache_state = {
            0: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None},
            1: {'should_calc': True, 'accumulated_rel_l1_distance': 0, 'previous_modulated_input': None, 'previous_residual': None}
        }

    def update_cache_state(cache, modulated_inp):
        if cache['previous_modulated_input'] is not None:
            try:
                cache['accumulated_rel_l1_distance'] += poly1d(coefficients, ((modulated_inp-cache['previous_modulated_input']).abs().mean() / cache['previous_modulated_input'].abs().mean()))
                if cache['accumulated_rel_l1_distance'] < rel_l1_thresh:
                    cache['should_calc'] = False
                else:
                    cache['should_calc'] = True
                    cache['accumulated_rel_l1_distance'] = 0
            except:
                cache['should_calc'] = True
                cache['accumulated_rel_l1_distance'] = 0
        cache['previous_modulated_input'] = modulated_inp
        
    b = int(len(x) / len(cond_or_uncond))

    for i, k in enumerate(cond_or_uncond):
        update_cache_state(self.teacache_state[k], modulated_inp[i*b:(i+1)*b])

    if enable_teacache:
        should_calc = False
        for k in cond_or_uncond:
            should_calc = (should_calc or self.teacache_state[k]['should_calc'])
    else:
        should_calc = True

    if not should_calc:
        for i, k in enumerate(cond_or_uncond):
            x[i*b:(i+1)*b] += self.teacache_state[k]['previous_residual'].to(x.device)
    else:
        ori_x = x.to(cache_device)
        for i, block in enumerate(self.blocks):
            if ("double_block", i) in blocks_replace:
                def block_wrap(args):
                    out = {}
                    out["img"] = block(args["img"], context=args["txt"], e=args["vec"], freqs=args["pe"], context_img_len=context_img_len)
                    return out
                out = blocks_replace[("double_block", i)]({"img": x, "txt": context, "vec": e0, "pe": freqs}, {"original_block": block_wrap, "transformer_options": transformer_options})
                x = out["img"]
            else:
                x = block(x, e=e0, freqs=freqs, context=context, context_img_len=context_img_len)
        for i, k in enumerate(cond_or_uncond):
            self.teacache_state[k]['previous_residual'] = (x.to(cache_device) - ori_x)[i*b:(i+1)*b]

    x = self.head(x, e)

    x = self.unpatchify(x, grid_sizes)
    return x

def create_patch_unet_model__forward_teacache(model):
    """
    TeaCache patch for ComfyUI's UNetModel (SDXL/SD1.5).

    Strategy:
    - Always run the first 2 input blocks to get a stable early hidden state `h`
    - Use TeaCache gating (accumulated rel-L1 distance of early hidden state) to decide whether to
      skip the remaining (expensive) blocks
    - When skipping, reuse a cached residual in the SAME hidden-state space and then run the cheap final `out`
    """
    from comfy.ldm.modules.diffusionmodules.openaimodel import timestep_embedding, forward_timestep_embed, apply_control

    def call_remaining_blocks(self, transformer_options, control,
                              transformer_patches, hs, h, *args, **kwargs):
        original_hidden_states = h

        for id, module in enumerate(self.input_blocks):
            if id < 2:
                continue
            transformer_options["block"] = ("input", id)
            h = forward_timestep_embed(module, h, *args, **kwargs)
            h = apply_control(h, control, 'input')
            if "input_block_patch" in transformer_patches:
                patch = transformer_patches["input_block_patch"]
                for p in patch:
                    h = p(h, transformer_options)

            hs.append(h)
            if "input_block_patch_after_skip" in transformer_patches:
                patch = transformer_patches["input_block_patch_after_skip"]
                for p in patch:
                    h = p(h, transformer_options)

        transformer_options["block"] = ("middle", 0)
        if self.middle_block is not None:
            h = forward_timestep_embed(self.middle_block, h, *args, **kwargs)
        h = apply_control(h, control, 'middle')

        for id, module in enumerate(self.output_blocks):
            transformer_options["block"] = ("output", id)
            hsp = hs.pop()
            hsp = apply_control(hsp, control, 'output')

            if "output_block_patch" in transformer_patches:
                patch = transformer_patches["output_block_patch"]
                for p in patch:
                    h, hsp = p(h, hsp, transformer_options)

            h = torch.cat([h, hsp], dim=1)
            del hsp
            if len(hs) > 0:
                output_shape = hs[-1].shape
            else:
                output_shape = None
            h = forward_timestep_embed(module, h, *args, output_shape,
                                       **kwargs)
        hidden_states_residual = h - original_hidden_states
        return h, hidden_states_residual

    def unet_model__forward(self,
                            x,
                            timesteps=None,
                            context=None,
                            y=None,
                            control=None,
                            transformer_options={},
                            **kwargs):
        transformer_options["original_shape"] = list(x.shape)
        transformer_options["transformer_index"] = 0
        transformer_patches = transformer_options.get("patches", {})

        # TeaCache options
        rel_l1_thresh = transformer_options.get("rel_l1_thresh", None)
        coefficients = transformer_options.get("coefficients", [0.0, 0.0, 0.0, 1.0, 0.0])
        enable_teacache = transformer_options.get("enable_teacache", True)
        cache_device = transformer_options.get("cache_device", x.device)

        # Defensive: if rel_l1_thresh not provided, do not skip
        if rel_l1_thresh is None:
            enable_teacache = False

        num_video_frames = kwargs.get("num_video_frames",
                                      self.default_num_video_frames)
        image_only_indicator = kwargs.get("image_only_indicator", None)
        time_context = kwargs.get("time_context", None)

        assert (y is not None) == (
            self.num_classes is not None
        ), "must specify y if and only if the model is class-conditional"
        hs = []
        t_emb = timestep_embedding(timesteps,
                                   self.model_channels,
                                   repeat_only=False).to(x.dtype)
        emb = self.time_embed(t_emb)

        if "emb_patch" in transformer_patches:
            patch = transformer_patches["emb_patch"]
            for p in patch:
                emb = p(emb, self.model_channels, transformer_options)

        if self.num_classes is not None:
            assert y.shape[0] == x.shape[0]
            emb = emb + self.label_emb(y)

        # Build early hidden state (first 2 input blocks)
        h = x
        for id, module in enumerate(self.input_blocks):
            if id >= 2:
                break
            transformer_options["block"] = ("input", id)
            h = forward_timestep_embed(
                module,
                h,
                emb,
                context,
                transformer_options,
                time_context=time_context,
                num_video_frames=num_video_frames,
                image_only_indicator=image_only_indicator)
            h = apply_control(h, control, 'input')
            if "input_block_patch" in transformer_patches:
                patch = transformer_patches["input_block_patch"]
                for p in patch:
                    h = p(h, transformer_options)

            hs.append(h)
            if "input_block_patch_after_skip" in transformer_patches:
                patch = transformer_patches["input_block_patch_after_skip"]
                for p in patch:
                    h = p(h, transformer_options)

        # TeaCache gating based on early hidden state
        # NOTE: we keep state on the UNet instance, consistent with other TeaCache forwards in this file.
        modulated_inp = h.to(cache_device)
        should_calc = True
        if not hasattr(self, 'accumulated_rel_l1_distance'):
            self.accumulated_rel_l1_distance = 0
        else:
            try:
                denom = self.previous_modulated_input.abs().mean().clamp_min(1e-8)
                rel = ((modulated_inp - self.previous_modulated_input).abs().mean() / denom)
                self.accumulated_rel_l1_distance += poly1d(coefficients, rel).abs()
                if self.accumulated_rel_l1_distance < rel_l1_thresh:
                    should_calc = False
                else:
                    should_calc = True
                    self.accumulated_rel_l1_distance = 0
            except Exception:
                should_calc = True
                self.accumulated_rel_l1_distance = 0

        self.previous_modulated_input = modulated_inp
        if not enable_teacache:
            should_calc = True

        can_use_cache = (not should_calc) and hasattr(self, 'teacache_unet_hidden_states_residual') and (self.teacache_unet_hidden_states_residual is not None)

        torch._dynamo.graph_break()
        if can_use_cache:
            h = h + self.teacache_unet_hidden_states_residual.to(h.device)
        else:
            h, hidden_states_residual = call_remaining_blocks(
                self,
                transformer_options,
                control,
                transformer_patches,
                hs,
                h,
                emb,
                context,
                transformer_options,
                time_context=time_context,
                num_video_frames=num_video_frames,
                image_only_indicator=image_only_indicator,
            )
            self.teacache_unet_hidden_states_residual = hidden_states_residual.to(cache_device)
        torch._dynamo.graph_break()

        # Final output head (cheap)
        return self.out(h)

    new_forward = unet_model__forward.__get__(model)
    return unittest.mock.patch.object(model, "forward", new_forward)

# ==================== FBCache 相关代码 ====================

@dataclasses.dataclass
class CacheContext:
    buffers: Dict[str, list] = dataclasses.field(default_factory=dict)
    incremental_name_counters: DefaultDict[str, int] = dataclasses.field(
        default_factory=lambda: defaultdict(int))
    sequence_num: int = 0
    use_cache: bool = False

    def get_incremental_name(self, name=None):
        if name is None:
            name = "default"
        idx = self.incremental_name_counters[name]
        self.incremental_name_counters[name] += 1
        return f"{name}_{idx}"

    def reset_incremental_names(self):
        self.incremental_name_counters.clear()

    @torch.compiler.disable()
    def get_buffer(self, name):
        item = self.buffers.get(name)
        if item is None or self.sequence_num >= len(item):
            return None
        return item[self.sequence_num]

    @torch.compiler.disable()
    def set_buffer(self, name, buffer):
        curr_item = self.buffers.get(name)
        if curr_item is None:
            curr_item = []
            self.buffers[name] = curr_item
        curr_item += [None] * (self.sequence_num - len(curr_item) + 1)
        curr_item[self.sequence_num] = buffer

    def clear_buffers(self):
        self.sequence_num = 0
        self.buffers.clear()

_current_cache_context = None

def create_cache_context():
    return CacheContext()

def get_current_cache_context():
    return _current_cache_context

def set_current_cache_context(cache_context=None):
    global _current_cache_context
    _current_cache_context = cache_context

@contextlib.contextmanager
def cache_context(cache_context):
    global _current_cache_context
    old_cache_context = _current_cache_context
    _current_cache_context = cache_context
    try:
        yield
    finally:
        _current_cache_context = old_cache_context

def patch_get_output_data():
    import execution

    get_output_data = getattr(execution, "get_output_data", None)
    if get_output_data is None:
        return

    if getattr(get_output_data, "_patched", False):
        return

    def new_get_output_data(*args, **kwargs):
        out = get_output_data(*args, **kwargs)
        cache_context = get_current_cache_context()
        if cache_context is not None:
            cache_context.clear_buffers()
            set_current_cache_context(None)
        return out

    new_get_output_data._patched = True
    execution.get_output_data = new_get_output_data

@torch.compiler.disable()
def get_buffer(name):
    cache_context = get_current_cache_context()
    assert cache_context is not None, "cache_context must be set before"
    return cache_context.get_buffer(name)

@torch.compiler.disable()
def set_buffer(name, buffer):
    cache_context = get_current_cache_context()
    assert cache_context is not None, "cache_context must be set before"
    cache_context.set_buffer(name, buffer)

@torch.compiler.disable()
def are_two_tensors_similar(t1, t2, *, threshold, only_shape=False):
    if t1.shape != t2.shape:
        return False
    elif only_shape:
        return True
    mean_diff = (t1 - t2).abs().mean()
    mean_t1 = t1.abs().mean()
    diff = mean_diff / mean_t1
    return diff.item() < threshold

@torch.compiler.disable()
def apply_prev_hidden_states_residual(hidden_states, encoder_hidden_states=None):
    hidden_states_residual = get_buffer("hidden_states_residual")
    assert hidden_states_residual is not None, "hidden_states_residual must be set before"
    hidden_states = hidden_states_residual + hidden_states
    hidden_states = hidden_states.contiguous()

    if encoder_hidden_states is None:
        return hidden_states

    encoder_hidden_states_residual = get_buffer("encoder_hidden_states_residual")
    if encoder_hidden_states_residual is None:
        encoder_hidden_states = None
    else:
        encoder_hidden_states = encoder_hidden_states_residual + encoder_hidden_states
        encoder_hidden_states = encoder_hidden_states.contiguous()

    return hidden_states, encoder_hidden_states

@torch.compiler.disable()
def get_can_use_cache(first_hidden_states_residual, threshold, parallelized=False, validation_function=None):
    prev_first_hidden_states_residual = get_buffer("first_hidden_states_residual")
    cache_context = get_current_cache_context()
    if cache_context is None or prev_first_hidden_states_residual is None:
        return False
    can_use_cache = are_two_tensors_similar(
        prev_first_hidden_states_residual,
        first_hidden_states_residual,
        threshold=threshold,
        only_shape=cache_context.sequence_num > 0,
    )
    if cache_context.sequence_num > 0:
        cache_context.use_cache &= can_use_cache
    else:
        if validation_function is not None:
            can_use_cache = validation_function(can_use_cache)
        cache_context.use_cache = can_use_cache
    return cache_context.use_cache

# FBCache的CachedTransformerBlocks类（简化版）
class CachedTransformerBlocks(torch.nn.Module):
    def __init__(
        self,
        transformer_blocks,
        single_transformer_blocks=None,
        *,
        residual_diff_threshold,
        validate_can_use_cache_function=None,
        return_hidden_states_first=True,
        accept_hidden_states_first=True,
        cat_hidden_states_first=False,
        return_hidden_states_only=False,
        clone_original_hidden_states=False,
        has_timestep_embedding_arg=False,
    ):
        super().__init__()
        self.transformer_blocks = transformer_blocks
        self.single_transformer_blocks = single_transformer_blocks
        self.residual_diff_threshold = residual_diff_threshold
        self.validate_can_use_cache_function = validate_can_use_cache_function
        self.return_hidden_states_first = return_hidden_states_first
        self.accept_hidden_states_first = accept_hidden_states_first
        self.cat_hidden_states_first = cat_hidden_states_first
        self.return_hidden_states_only = return_hidden_states_only
        self.clone_original_hidden_states = clone_original_hidden_states
        self.has_timestep_embedding_arg = has_timestep_embedding_arg

    def forward(self, *args, **kwargs):
        img_arg_name = None
        if "img" in kwargs:
            img_arg_name = "img"
        elif "hidden_states" in kwargs:
            img_arg_name = "hidden_states"
        txt_arg_name = None
        if "txt" in kwargs:
            txt_arg_name = "txt"
        elif "context" in kwargs:
            txt_arg_name = "context"
        elif "encoder_hidden_states" in kwargs:
            txt_arg_name = "encoder_hidden_states"
        
        if self.has_timestep_embedding_arg:
            if args:
                hidden_states = args[0]
                args = args[1:]
            else:
                hidden_states = kwargs.pop(img_arg_name)
            if args:
                timestep_embedding = args[0]
                args = args[1:]
            else:
                timestep_embedding = kwargs.pop("emb", None) or kwargs.pop("timestep_embedding", None)
                if timestep_embedding is None:
                    raise ValueError("timestep_embedding argument required but not found")
            if args:
                encoder_hidden_states = args[0]
                args = args[1:]
            else:
                encoder_hidden_states = kwargs.pop(txt_arg_name)
        elif self.accept_hidden_states_first:
            if args:
                img = args[0]
                args = args[1:]
            else:
                img = kwargs.pop(img_arg_name)
            if args:
                txt = args[0]
                args = args[1:]
            else:
                txt = kwargs.pop(txt_arg_name)
            hidden_states = img
            encoder_hidden_states = txt
            timestep_embedding = None
        else:
            if args:
                txt = args[0]
                args = args[1:]
            else:
                txt = kwargs.pop(txt_arg_name)
            if args:
                img = args[0]
                args = args[1:]
            else:
                img = kwargs.pop(img_arg_name)
            hidden_states = img
            encoder_hidden_states = txt
            timestep_embedding = None
        
        if self.residual_diff_threshold <= 0.0:
            for block in self.transformer_blocks:
                if self.has_timestep_embedding_arg:
                    hidden_states = block(hidden_states, timestep_embedding, encoder_hidden_states, *args, **kwargs)
                elif txt_arg_name == "encoder_hidden_states":
                    hidden_states = block(hidden_states, *args, encoder_hidden_states=encoder_hidden_states, **kwargs)
                else:
                    if self.accept_hidden_states_first:
                        hidden_states = block(hidden_states, encoder_hidden_states, *args, **kwargs)
                    else:
                        hidden_states = block(encoder_hidden_states, hidden_states, *args, **kwargs)
                if not self.return_hidden_states_only:
                    hidden_states, encoder_hidden_states = hidden_states
                    if not self.return_hidden_states_first:
                        hidden_states, encoder_hidden_states = encoder_hidden_states, hidden_states
            if self.single_transformer_blocks is not None:
                hidden_states = torch.cat([hidden_states, encoder_hidden_states] if self.cat_hidden_states_first else [encoder_hidden_states, hidden_states], dim=1)
                for block in self.single_transformer_blocks:
                    kwargs.pop("modulation_dims_img", None)
                    kwargs.pop("modulation_dims_txt", None)
                    hidden_states = block(hidden_states, *args, **kwargs)
                hidden_states = hidden_states[:, encoder_hidden_states.shape[1]:]
            if self.return_hidden_states_only:
                return hidden_states
            else:
                return ((hidden_states, encoder_hidden_states) if self.return_hidden_states_first else (encoder_hidden_states, hidden_states))

        original_hidden_states = hidden_states
        if self.clone_original_hidden_states:
            original_hidden_states = original_hidden_states.clone()
        first_transformer_block = self.transformer_blocks[0]
        if self.has_timestep_embedding_arg:
            hidden_states = first_transformer_block(hidden_states, timestep_embedding, encoder_hidden_states, *args, **kwargs)
        elif txt_arg_name == "encoder_hidden_states":
            hidden_states = first_transformer_block(hidden_states, *args, encoder_hidden_states=encoder_hidden_states, **kwargs)
        else:
            if self.accept_hidden_states_first:
                hidden_states = first_transformer_block(hidden_states, encoder_hidden_states, *args, **kwargs)
            else:
                hidden_states = first_transformer_block(encoder_hidden_states, hidden_states, *args, **kwargs)
        if not self.return_hidden_states_only:
            hidden_states, encoder_hidden_states = hidden_states
            if not self.return_hidden_states_first:
                hidden_states, encoder_hidden_states = encoder_hidden_states, hidden_states
        first_hidden_states_residual = hidden_states - original_hidden_states
        del original_hidden_states

        can_use_cache = get_can_use_cache(
            first_hidden_states_residual,
            threshold=self.residual_diff_threshold,
            validation_function=self.validate_can_use_cache_function,
        )

        torch._dynamo.graph_break()
        if can_use_cache:
            del first_hidden_states_residual
            hidden_states, encoder_hidden_states = apply_prev_hidden_states_residual(hidden_states, encoder_hidden_states)
        else:
            set_buffer("first_hidden_states_residual", first_hidden_states_residual)
            del first_hidden_states_residual
            (hidden_states, encoder_hidden_states, hidden_states_residual, encoder_hidden_states_residual) = self.call_remaining_transformer_blocks(
                hidden_states, encoder_hidden_states, timestep_embedding if self.has_timestep_embedding_arg else None, *args, txt_arg_name=txt_arg_name, **kwargs)
            set_buffer("hidden_states_residual", hidden_states_residual)
            if encoder_hidden_states_residual is not None:
                set_buffer("encoder_hidden_states_residual", encoder_hidden_states_residual)
        torch._dynamo.graph_break()

        if self.return_hidden_states_only:
            return hidden_states
        else:
            return ((hidden_states, encoder_hidden_states) if self.return_hidden_states_first else (encoder_hidden_states, hidden_states))
    
    def call_remaining_transformer_blocks(self, hidden_states, encoder_hidden_states, timestep_embedding=None, *args, txt_arg_name=None, **kwargs):
        original_hidden_states = hidden_states
        original_encoder_hidden_states = encoder_hidden_states
        if self.clone_original_hidden_states:
            original_hidden_states = original_hidden_states.clone()
            original_encoder_hidden_states = original_encoder_hidden_states.clone()
        for block in self.transformer_blocks[1:]:
            if self.has_timestep_embedding_arg:
                hidden_states = block(hidden_states, timestep_embedding, encoder_hidden_states, *args, **kwargs)
            elif txt_arg_name == "encoder_hidden_states":
                hidden_states = block(hidden_states, *args, encoder_hidden_states=encoder_hidden_states, **kwargs)
            else:
                if self.accept_hidden_states_first:
                    hidden_states = block(hidden_states, encoder_hidden_states, *args, **kwargs)
                else:
                    hidden_states = block(encoder_hidden_states, hidden_states, *args, **kwargs)
            if not self.return_hidden_states_only:
                hidden_states, encoder_hidden_states = hidden_states
                if not self.return_hidden_states_first:
                    hidden_states, encoder_hidden_states = encoder_hidden_states, hidden_states
        if self.single_transformer_blocks is not None:
            hidden_states = torch.cat([hidden_states, encoder_hidden_states] if self.cat_hidden_states_first else [encoder_hidden_states, hidden_states], dim=1)
            for block in self.single_transformer_blocks:
                kwargs.pop("modulation_dims_img", None)
                kwargs.pop("modulation_dims_txt", None)
                hidden_states = block(hidden_states, *args, **kwargs)
            if self.cat_hidden_states_first:
                hidden_states, encoder_hidden_states = hidden_states.split([hidden_states.shape[1] - encoder_hidden_states.shape[1], encoder_hidden_states.shape[1]], dim=1)
            else:
                encoder_hidden_states, hidden_states = hidden_states.split([encoder_hidden_states.shape[1], hidden_states.shape[1] - encoder_hidden_states.shape[1]], dim=1)

        hidden_states = hidden_states.reshape(-1).contiguous().reshape(original_hidden_states.shape)
        if encoder_hidden_states is not None:
            encoder_hidden_states = encoder_hidden_states.reshape(-1).contiguous().reshape(original_encoder_hidden_states.shape)

        hidden_states_residual = hidden_states - original_hidden_states
        hidden_states_residual = hidden_states_residual.reshape(-1).contiguous().reshape(original_hidden_states.shape)
        if encoder_hidden_states is None:
            encoder_hidden_states_residual = None
        else:
            encoder_hidden_states_residual = encoder_hidden_states - original_encoder_hidden_states
            encoder_hidden_states_residual = encoder_hidden_states_residual.reshape(-1).contiguous().reshape(original_encoder_hidden_states.shape)
        return hidden_states, encoder_hidden_states, hidden_states_residual, encoder_hidden_states_residual

# FBCache的patch函数（完整实现）
# Based on 90f349f93df3083a507854d7fc7c3e1bb9014e24
def create_patch_unet_model__forward(model, *, residual_diff_threshold, validate_can_use_cache_function=None):
    from comfy.ldm.modules.diffusionmodules.openaimodel import timestep_embedding, forward_timestep_embed, apply_control

    def call_remaining_blocks(self, transformer_options, control,
                              transformer_patches, hs, h, *args, **kwargs):
        original_hidden_states = h

        for id, module in enumerate(self.input_blocks):
            if id < 2:
                continue
            transformer_options["block"] = ("input", id)
            h = forward_timestep_embed(module, h, *args, **kwargs)
            h = apply_control(h, control, 'input')
            if "input_block_patch" in transformer_patches:
                patch = transformer_patches["input_block_patch"]
                for p in patch:
                    h = p(h, transformer_options)

            hs.append(h)
            if "input_block_patch_after_skip" in transformer_patches:
                patch = transformer_patches["input_block_patch_after_skip"]
                for p in patch:
                    h = p(h, transformer_options)

        transformer_options["block"] = ("middle", 0)
        if self.middle_block is not None:
            h = forward_timestep_embed(self.middle_block, h, *args, **kwargs)
        h = apply_control(h, control, 'middle')

        for id, module in enumerate(self.output_blocks):
            transformer_options["block"] = ("output", id)
            hsp = hs.pop()
            hsp = apply_control(hsp, control, 'output')

            if "output_block_patch" in transformer_patches:
                patch = transformer_patches["output_block_patch"]
                for p in patch:
                    h, hsp = p(h, hsp, transformer_options)

            h = torch.cat([h, hsp], dim=1)
            del hsp
            if len(hs) > 0:
                output_shape = hs[-1].shape
            else:
                output_shape = None
            h = forward_timestep_embed(module, h, *args, output_shape,
                                       **kwargs)
        hidden_states_residual = h - original_hidden_states
        return h, hidden_states_residual

    def unet_model__forward(self,
                            x,
                            timesteps=None,
                            context=None,
                            y=None,
                            control=None,
                            transformer_options={},
                            **kwargs):
        """
        Apply the model to an input batch.
        :param x: an [N x C x ...] Tensor of inputs.
        :param timesteps: a 1-D batch of timesteps.
        :param context: conditioning plugged in via crossattn
        :param y: an [N] Tensor of labels, if class-conditional.
        :return: an [N x C x ...] Tensor of outputs.
        """
        transformer_options["original_shape"] = list(x.shape)
        transformer_options["transformer_index"] = 0
        transformer_patches = transformer_options.get("patches", {})

        num_video_frames = kwargs.get("num_video_frames",
                                      self.default_num_video_frames)
        image_only_indicator = kwargs.get("image_only_indicator", None)
        time_context = kwargs.get("time_context", None)

        assert (y is not None) == (
            self.num_classes is not None
        ), "must specify y if and only if the model is class-conditional"
        hs = []
        t_emb = timestep_embedding(timesteps,
                                   self.model_channels,
                                   repeat_only=False).to(x.dtype)
        emb = self.time_embed(t_emb)

        if "emb_patch" in transformer_patches:
            patch = transformer_patches["emb_patch"]
            for p in patch:
                emb = p(emb, self.model_channels, transformer_options)

        if self.num_classes is not None:
            assert y.shape[0] == x.shape[0]
            emb = emb + self.label_emb(y)

        can_use_cache = False

        h = x
        for id, module in enumerate(self.input_blocks):
            if id >= 2:
                break
            transformer_options["block"] = ("input", id)
            if id == 1:
                original_h = h
            h = forward_timestep_embed(
                module,
                h,
                emb,
                context,
                transformer_options,
                time_context=time_context,
                num_video_frames=num_video_frames,
                image_only_indicator=image_only_indicator)
            h = apply_control(h, control, 'input')
            if "input_block_patch" in transformer_patches:
                patch = transformer_patches["input_block_patch"]
                for p in patch:
                    h = p(h, transformer_options)

            hs.append(h)
            if "input_block_patch_after_skip" in transformer_patches:
                patch = transformer_patches["input_block_patch_after_skip"]
                for p in patch:
                    h = p(h, transformer_options)

            if id == 1:
                first_hidden_states_residual = h - original_h
                can_use_cache = get_can_use_cache(
                    first_hidden_states_residual,
                    threshold=residual_diff_threshold,
                    validation_function=validate_can_use_cache_function,
                )
                if not can_use_cache:
                    set_buffer("first_hidden_states_residual",
                               first_hidden_states_residual)
                del first_hidden_states_residual

        torch._dynamo.graph_break()
        if can_use_cache:
            h = apply_prev_hidden_states_residual(h)
        else:
            h, hidden_states_residual = call_remaining_blocks(
                self,
                transformer_options,
                control,
                transformer_patches,
                hs,
                h,
                emb,
                context,
                transformer_options,
                time_context=time_context,
                num_video_frames=num_video_frames,
                image_only_indicator=image_only_indicator)
            set_buffer("hidden_states_residual", hidden_states_residual)
        torch._dynamo.graph_break()

        h = h.type(x.dtype)

        if self.predict_codebook_ids:
            return self.id_predictor(h)
        else:
            return self.out(h)

    new__forward = unet_model__forward.__get__(model)

    @contextlib.contextmanager
    def patch__forward():
        with unittest.mock.patch.object(model, "_forward", new__forward):
            yield

    return patch__forward

# Based on 90f349f93df3083a507854d7fc7c3e1bb9014e24
def create_patch_flux_forward_orig(model, *, residual_diff_threshold, validate_can_use_cache_function=None):
    from torch import Tensor
    from comfy.ldm.flux.model import timestep_embedding

    def call_remaining_blocks(self, blocks_replace, control, img, txt, vec, pe,
                              attn_mask, ca_idx, timesteps, transformer_options, vec_orig=None):
        original_hidden_states = img

        extra_block_forward_kwargs = {}
        if attn_mask is not None:
            extra_block_forward_kwargs["attn_mask"] = attn_mask

        for i, block in enumerate(self.double_blocks):
            if i < 1:
                continue
            if ("double_block", i) in blocks_replace:

                def block_wrap(args):
                    out = {}
                    out["img"], out["txt"] = block(
                        img=args["img"],
                        txt=args["txt"],
                        vec=args["vec"],
                        pe=args["pe"],
                        **extra_block_forward_kwargs)
                    return out

                out = blocks_replace[("double_block",
                                      i)]({
                                          "img": img,
                                          "txt": txt,
                                          "vec": vec,
                                          "pe": pe,
                                          **extra_block_forward_kwargs
                                      }, {
                                          "original_block": block_wrap,
                                          "transformer_options": transformer_options
                                      })
                txt = out["txt"]
                img = out["img"]
            else:
                img, txt = block(img=img,
                                 txt=txt,
                                 vec=vec,
                                 pe=pe,
                                 **extra_block_forward_kwargs)

            if control is not None:  # Controlnet
                control_i = control.get("input")
                if i < len(control_i):
                    add = control_i[i]
                    if add is not None:
                        img += add

            # PuLID attention
            if getattr(self, "pulid_data", {}):
                if i % self.pulid_double_interval == 0:
                    # Will calculate influence of all pulid nodes at once
                    for _, node_data in self.pulid_data.items():
                        if torch.any((node_data['sigma_start'] >= timesteps)
                                     & (timesteps >= node_data['sigma_end'])):
                            img = img + node_data['weight'] * self.pulid_ca[
                                ca_idx](node_data['embedding'], img)
                    ca_idx += 1

        img = torch.cat((txt, img), 1)

        # For single_blocks, if global_modulation is enabled, we need to recalculate vec from vec_orig
        if vec_orig is not None and self.params.global_modulation:
            vec, _ = self.single_stream_modulation(vec_orig)

        for i, block in enumerate(self.single_blocks):
            if ("single_block", i) in blocks_replace:

                def block_wrap(args):
                    out = {}
                    out["img"] = block(args["img"],
                                       vec=args["vec"],
                                       pe=args["pe"],
                                       **extra_block_forward_kwargs)
                    return out

                out = blocks_replace[("single_block",
                                      i)]({
                                          "img": img,
                                          "vec": vec,
                                          "pe": pe,
                                          **extra_block_forward_kwargs
                                      }, {
                                          "original_block": block_wrap,
                                          "transformer_options": transformer_options
                                      })
                img = out["img"]
            else:
                img = block(img, vec=vec, pe=pe, **extra_block_forward_kwargs)

            if control is not None:  # Controlnet
                control_o = control.get("output")
                if i < len(control_o):
                    add = control_o[i]
                    if add is not None:
                        img[:, txt.shape[1]:, ...] += add

            # PuLID attention
            if getattr(self, "pulid_data", {}):
                real_img, txt = img[:, txt.shape[1]:,
                                    ...], img[:, :txt.shape[1], ...]
                if i % self.pulid_single_interval == 0:
                    # Will calculate influence of all nodes at once
                    for _, node_data in self.pulid_data.items():
                        if torch.any((node_data['sigma_start'] >= timesteps)
                                     & (timesteps >= node_data['sigma_end'])):
                            real_img = real_img + node_data[
                                'weight'] * self.pulid_ca[ca_idx](
                                    node_data['embedding'], real_img)
                    ca_idx += 1
                img = torch.cat((txt, real_img), 1)

        img = img[:, txt.shape[1]:, ...]

        img = img.contiguous()
        hidden_states_residual = img - original_hidden_states
        return img, hidden_states_residual

    def forward_orig(
        self,
        img: Tensor,
        img_ids: Tensor,
        txt: Tensor,
        txt_ids: Tensor,
        timesteps: Tensor,
        y: Tensor,
        guidance: Tensor = None,
        control=None,
        transformer_options={},
        attn_mask: Tensor = None,
    ) -> Tensor:
        patches_replace = transformer_options.get("patches_replace", {})
        if img.ndim != 3 or txt.ndim != 3:
            raise ValueError(
                "Input img and txt tensors must have 3 dimensions.")

        # running on sequences img
        img = self.img_in(img)
        vec = self.time_in(timestep_embedding(timesteps, 256).to(img.dtype))
        if self.params.guidance_embed:
            if guidance is None:
                raise ValueError(
                    "Didn't get guidance strength for guidance distilled model."
                )
            vec = vec + self.guidance_in(
                timestep_embedding(guidance, 256).to(img.dtype))

        if self.vector_in is not None:
            if y is None:
                y = torch.zeros((img.shape[0], self.params.vec_in_dim), device=img.device, dtype=img.dtype)
            vec = vec + self.vector_in(y[:, :self.params.vec_in_dim])

        if self.txt_norm is not None:
            txt = self.txt_norm(txt)
        txt = self.txt_in(txt)

        vec_orig = vec
        if self.params.global_modulation:
            vec = (self.double_stream_modulation_img(vec_orig), self.double_stream_modulation_txt(vec_orig))

        ids = torch.cat((txt_ids, img_ids), dim=1)
        pe = self.pe_embedder(ids)

        ca_idx = 0
        extra_block_forward_kwargs = {}
        if attn_mask is not None:
            extra_block_forward_kwargs["attn_mask"] = attn_mask
        blocks_replace = patches_replace.get("dit", {})
        can_use_cache = False
        for i, block in enumerate(self.double_blocks):
            if i >= 1:
                break
            if ("double_block", i) in blocks_replace:

                def block_wrap(args):
                    out = {}
                    out["img"], out["txt"] = block(
                        img=args["img"],
                        txt=args["txt"],
                        vec=args["vec"],
                        pe=args["pe"],
                        **extra_block_forward_kwargs)
                    return out

                out = blocks_replace[("double_block",
                                      i)]({
                                          "img": img,
                                          "txt": txt,
                                          "vec": vec,
                                          "pe": pe,
                                          **extra_block_forward_kwargs
                                      }, {
                                          "original_block": block_wrap,
                                          "transformer_options": transformer_options
                                      })
                txt = out["txt"]
                img = out["img"]
            else:
                img, txt = block(img=img,
                                 txt=txt,
                                 vec=vec,
                                 pe=pe,
                                 **extra_block_forward_kwargs)

            if control is not None:  # Controlnet
                control_i = control.get("input")
                if i < len(control_i):
                    add = control_i[i]
                    if add is not None:
                        img += add

            # PuLID attention
            if getattr(self, "pulid_data", {}):
                if i % self.pulid_double_interval == 0:
                    # Will calculate influence of all pulid nodes at once
                    for _, node_data in self.pulid_data.items():
                        if torch.any((node_data['sigma_start'] >= timesteps)
                                     & (timesteps >= node_data['sigma_end'])):
                            img = img + node_data['weight'] * self.pulid_ca[
                                ca_idx](node_data['embedding'], img)
                    ca_idx += 1

            if i == 0:
                first_hidden_states_residual = img
                can_use_cache = get_can_use_cache(
                    first_hidden_states_residual,
                    threshold=residual_diff_threshold,
                    validation_function=validate_can_use_cache_function,
                )
                if not can_use_cache:
                    set_buffer("first_hidden_states_residual",
                               first_hidden_states_residual)
                del first_hidden_states_residual

        torch._dynamo.graph_break()
        if can_use_cache:
            img = apply_prev_hidden_states_residual(img)
        else:
            img, hidden_states_residual = call_remaining_blocks(
                self,
                blocks_replace,
                control,
                img,
                txt,
                vec,
                pe,
                attn_mask,
                ca_idx,
                timesteps,
                transformer_options,
                vec_orig,
            )
            set_buffer("hidden_states_residual", hidden_states_residual)
        torch._dynamo.graph_break()

        img = self.final_layer(img,
                               vec_orig)  # (N, T, patch_size ** 2 * out_channels)
        return img

    new_forward_orig = forward_orig.__get__(model)

    @contextlib.contextmanager
    def patch_forward_orig():
        with unittest.mock.patch.object(model, "forward_orig",
                                        new_forward_orig):
            yield

    return patch_forward_orig

# ==================== Magic Cache 节点 ====================

# 全局字典存储每个节点的参数（key是unique_id）
_magic_cache_node_params = {}

class MagicCache:
    """
    融合 TeaCache 和 FBCache 的通用缓存优化节点 /
    A unified cache optimization node combining TeaCache and FBCache.

    支持三种模式 (Supports three modes):
    - TeaCache: 仅使用 TeaCache 优化 / TeaCache only
    - FBCache: 仅使用 FBCache 优化 / FBCache only
    - Both: 同时使用两种优化（推荐，可获得更佳性能）/ Use both (recommended for best performance)
    """
    
    def __init__(self):
        # 参数将在apply_cache中从kwargs获取
        pass
    
    def log(self, msg, type="info"):
        """统一的日志输出方法"""
        RESET = "\033[0m"
        CYAN = "\033[36m"
        GREEN = "\033[32m"
        YELLOW = "\033[33m"
        RED = "\033[31m"
        BLUE = "\033[34m"
        prefix = "⚡ [Magic-Cache]"
        
        if type == "start":
            print(f"{YELLOW}{prefix} 🚀 Start | {msg}{RESET}")
        elif type == "success":
            print(f"{GREEN}{prefix} ✅ Done  | {msg}{RESET}")
        elif type == "error":
            print(f"{RED}{prefix} ❌ Error | {msg}{RESET}")
        elif type == "warning":
            print(f"{YELLOW}{prefix} ⚠️ Warn  | {msg}{RESET}")
        elif type == "info":
            print(f"{CYAN}{prefix} ℹ️ Info  | {msg}{RESET}")
        elif type == "param":
            print(f"{BLUE}{prefix} 📋 Param | {msg}{RESET}")
        else:
            print(f"{CYAN}{prefix} ℹ️ Info  | {msg}{RESET}")
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "要应用缓存优化的扩散模型 (Diffusion model to apply cache optimization)"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "cache_mode": "STRING",
                "teacache_params_json": "STRING",
                "fbcache_params_json": "STRING",
            }
        }
    
    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "apply_cache"
    CATEGORY = "✨ Magic Assistant"
    TITLE = "⚡ Magic Cache 缓存加速 (TeaCache + FBCache)"
    
    def apply_cache(self, model, unique_id=None, cache_mode="Both", teacache_params_json="{}", fbcache_params_json="{}", **kwargs):
        """
        应用缓存优化
        参数从hidden widget中获取（由web UI设置）
        """
        import json
        
        # 打印开始信息
        self.log(f"应用缓存优化 (Mode: {cache_mode})", "start")
        
        # 解析JSON参数
        try:
            teacache_params = json.loads(teacache_params_json) if teacache_params_json else {}
        except Exception as e:
            self.log(f"解析 TeaCache 参数失败，使用默认值: {e}", "warning")
            teacache_params = {}
        
        try:
            fbcache_params = json.loads(fbcache_params_json) if fbcache_params_json else {}
        except Exception as e:
            self.log(f"解析 FBCache 参数失败，使用默认值: {e}", "warning")
            fbcache_params = {}
        
        # 使用默认值填充缺失的参数
        if not teacache_params:
            teacache_params = {
                "model_type": "flux",
                "rel_l1_thresh": 0.4,
                "start_percent": 0.0,
                "end_percent": 1.0,
                "cache_device": "cuda"
            }
        else:
            teacache_params.setdefault("model_type", "flux")
            teacache_params.setdefault("rel_l1_thresh", 0.4)
            teacache_params.setdefault("start_percent", 0.0)
            teacache_params.setdefault("end_percent", 1.0)
            teacache_params.setdefault("cache_device", "cuda")
        
        if not fbcache_params:
            fbcache_params = {
                "object_to_patch": "diffusion_model",
                "residual_diff_threshold": 0.0,
                "start": 0.0,
                "end": 1.0,
                "max_consecutive_cache_hits": -1
            }
        else:
            fbcache_params.setdefault("object_to_patch", "diffusion_model")
            fbcache_params.setdefault("residual_diff_threshold", 0.0)
            fbcache_params.setdefault("start", 0.0)
            fbcache_params.setdefault("end", 1.0)
            fbcache_params.setdefault("max_consecutive_cache_hits", -1)
        
        # 打印参数信息
        if cache_mode in ["TeaCache", "Both"]:
            self.log(f"TeaCache 参数: model_type={teacache_params['model_type']}, "
                    f"rel_l1_thresh={teacache_params['rel_l1_thresh']}, "
                    f"start_percent={teacache_params['start_percent']}, "
                    f"end_percent={teacache_params['end_percent']}, "
                    f"cache_device={teacache_params['cache_device']}", "param")
        
        if cache_mode in ["FBCache", "Both"]:
            self.log(f"FBCache 参数: object_to_patch={fbcache_params['object_to_patch']}, "
                    f"residual_diff_threshold={fbcache_params['residual_diff_threshold']}, "
                    f"start={fbcache_params['start']}, "
                    f"end={fbcache_params['end']}, "
                    f"max_consecutive_cache_hits={fbcache_params['max_consecutive_cache_hits']}", "param")
        
        result_model = model
        teacache_success = False
        fbcache_success = False
        
        # 应用TeaCache
        if cache_mode in ["TeaCache", "Both"]:
            try:
                self.log("正在应用 TeaCache 优化...", "info")
                result_model = self._apply_teacache(
                    result_model,
                    model_type=teacache_params.get("model_type", "flux"),
                    rel_l1_thresh=teacache_params.get("rel_l1_thresh", 0.4),
                    start_percent=teacache_params.get("start_percent", 0.0),
                    end_percent=teacache_params.get("end_percent", 1.0),
                    cache_device=teacache_params.get("cache_device", "cuda"),
                )
                teacache_success = True
                self.log(f"TeaCache 应用成功 (model_type={teacache_params['model_type']}, "
                        f"rel_l1_thresh={teacache_params['rel_l1_thresh']}, "
                        f"范围={teacache_params['start_percent']:.1%}-{teacache_params['end_percent']:.1%})", "success")
            except Exception as e:
                self.log(f"TeaCache 应用失败: {e}", "error")
                if cache_mode == "TeaCache":
                    self.log("TeaCache 模式失败，返回原始模型", "warning")
                    return (model,)
        
        # 应用FBCache
        if cache_mode in ["FBCache", "Both"]:
            try:
                self.log("正在应用 FBCache 优化...", "info")
                result_model = self._apply_fbcache(
                    result_model,
                    object_to_patch=fbcache_params.get("object_to_patch", "diffusion_model"),
                    residual_diff_threshold=fbcache_params.get("residual_diff_threshold", 0.0),
                    max_consecutive_cache_hits=fbcache_params.get("max_consecutive_cache_hits", -1),
                    start=fbcache_params.get("start", 0.0),
                    end=fbcache_params.get("end", 1.0),
                )
                fbcache_success = True
                self.log(f"FBCache 应用成功 (residual_diff_threshold={fbcache_params['residual_diff_threshold']}, "
                        f"范围={fbcache_params['start']:.1%}-{fbcache_params['end']:.1%}, "
                        f"max_hits={fbcache_params['max_consecutive_cache_hits']})", "success")
            except Exception as e:
                self.log(f"FBCache 应用失败: {e}", "error")
                if cache_mode == "FBCache":
                    self.log("FBCache 模式失败，返回原始模型", "warning")
                    return (model,)
        
        # 打印总结信息
        if cache_mode == "Both":
            if teacache_success and fbcache_success:
                self.log("所有缓存优化已成功应用 (TeaCache + FBCache)", "success")
            elif teacache_success:
                self.log("部分成功: TeaCache 已应用，FBCache 失败", "warning")
            elif fbcache_success:
                self.log("部分成功: FBCache 已应用，TeaCache 失败", "warning")
            else:
                self.log("所有缓存优化均失败，返回原始模型", "error")
        elif cache_mode == "TeaCache":
            if teacache_success:
                self.log("TeaCache 优化已成功应用", "success")
            else:
                self.log("TeaCache 优化失败，返回原始模型", "error")
        elif cache_mode == "FBCache":
            if fbcache_success:
                self.log("FBCache 优化已成功应用", "success")
            else:
                self.log("FBCache 优化失败，返回原始模型", "error")
        
        return (result_model,)
    
    def _apply_teacache(self, model, model_type, rel_l1_thresh, start_percent, end_percent, cache_device):
        """应用TeaCache优化"""
        if rel_l1_thresh == 0:
            self.log("rel_l1_thresh=0，跳过 TeaCache 优化", "info")
            return model

        new_model = model.clone()
        model_options = getattr(new_model, 'model_options', None)
        if model_options is None or not isinstance(model_options, dict):
            model_options = {}
            setattr(new_model, 'model_options', model_options)
        if 'transformer_options' not in model_options:
            model_options['transformer_options'] = {}
        transformer_options = model_options['transformer_options']
        
        diffusion_model = new_model.get_model_object("diffusion_model")
        
        if diffusion_model is None:
            self.log("未找到 diffusion_model，跳过 TeaCache 优化", "warning")
            return new_model

        # Auto-adapt: UNetModel (SDXL/SD1.5) can use TeaCache with model_type sdxl/sd15
        if diffusion_model.__class__.__name__ == "UNetModel" and model_type not in ("sdxl", "sd15"):
            # prefer SDXL fallback name; SD1.5 users can explicitly pick sd15 in UI
            self.log(f"检测到 UNetModel，TeaCache model_type 从 '{model_type}' 自动切换为 'sdxl'（可在UI选择 sd15/SDXL）", "warning")
            model_type = "sdxl"

        if model_type not in SUPPORTED_MODELS_COEFFICIENTS:
            supported_types = ", ".join(SUPPORTED_MODELS_COEFFICIENTS.keys())
            error_msg = f"不支持的模型类型: {model_type}。支持的类型: {supported_types}"
            self.log(error_msg, "error")
            raise ValueError(error_msg)

        transformer_options["rel_l1_thresh"] = rel_l1_thresh
        transformer_options["coefficients"] = SUPPORTED_MODELS_COEFFICIENTS[model_type]
        transformer_options["model_type"] = model_type
        transformer_options["cache_device"] = mm.get_torch_device() if cache_device == "cuda" else torch.device("cpu")

        if diffusion_model.__class__.__name__ == "UNetModel" or model_type in ("sdxl", "sd15"):
            is_cfg = False
            # TeaCache patch for UNetModel (SDXL/SD1.5)
            context = create_patch_unet_model__forward_teacache(diffusion_model)
        elif "flux" in model_type or "klein" in model_type or "sdnq" in model_type or "anima" in model_type:
            is_cfg = False
            # Save original forward as forward_orig if it doesn't exist
            if not hasattr(diffusion_model, 'forward_orig'):
                diffusion_model.forward_orig = diffusion_model.forward
            context = patch.multiple(
                diffusion_model,
                forward=teacache_flux_forward.__get__(diffusion_model, diffusion_model.__class__)
            )
        elif "lumina_2" in model_type:
            is_cfg = True
            context = patch.multiple(
                diffusion_model,
                forward=teacache_lumina_forward.__get__(diffusion_model, diffusion_model.__class__)
            )
        elif "hidream_i1" in model_type:
            is_cfg = True if "full" in model_type else False
            context = patch.multiple(
                diffusion_model,
                forward=teacache_hidream_forward.__get__(diffusion_model, diffusion_model.__class__)
            )
        elif "ltxv" in model_type:
            is_cfg = True
            context = patch.multiple(
                diffusion_model,
                forward=teacache_ltxvmodel_forward.__get__(diffusion_model, diffusion_model.__class__)
            )
        elif "hunyuan_video" in model_type:
            is_cfg = False
            if not hasattr(diffusion_model, 'forward_orig'):
                diffusion_model.forward_orig = diffusion_model.forward
            context = patch.multiple(
                diffusion_model,
                forward=teacache_hunyuanvideo_forward.__get__(diffusion_model, diffusion_model.__class__)
            )
        elif "wan2.1" in model_type:
            is_cfg = True
            if not hasattr(diffusion_model, 'forward_orig'):
                diffusion_model.forward_orig = diffusion_model.forward
            context = patch.multiple(
                diffusion_model,
                forward=teacache_wanmodel_forward.__get__(diffusion_model, diffusion_model.__class__)
            )
        else:
            supported_types = ", ".join(SUPPORTED_MODELS_COEFFICIENTS.keys())
            error_msg = f"不支持的模型类型: {model_type}。支持的类型: {supported_types}"
            self.log(error_msg, "error")
            raise ValueError(error_msg)
        
        def unet_wrapper_function(model_function, kwargs):
            input = kwargs["input"]
            timestep = kwargs["timestep"]
            c = kwargs["c"]
            if "transformer_options" not in c:
                c["transformer_options"] = {}
            transformer_options = c["transformer_options"]
            sigmas = transformer_options.get("sample_sigmas")
            if sigmas is None:
                model_opts = getattr(new_model, 'model_options', {})
                if isinstance(model_opts, dict) and "transformer_options" in model_opts:
                    sigmas = model_opts["transformer_options"].get("sample_sigmas")
            if sigmas is None:
                with context:
                    return model_function(input, timestep, **c)
            
            matched_step_index = (sigmas == timestep[0]).nonzero()
            if len(matched_step_index) > 0:
                current_step_index = matched_step_index.item()
            else:
                current_step_index = 0
                for i in range(len(sigmas) - 1):
                    if (sigmas[i] - timestep[0]) * (sigmas[i + 1] - timestep[0]) <= 0:
                        current_step_index = i
                        break
            
            if current_step_index == 0:
                # Reset TeaCache state at the beginning of a sampling sequence
                if hasattr(diffusion_model, 'teacache_state'):
                    delattr(diffusion_model, 'teacache_state')
                if hasattr(diffusion_model, 'accumulated_rel_l1_distance'):
                    delattr(diffusion_model, 'accumulated_rel_l1_distance')
                if hasattr(diffusion_model, 'previous_modulated_input'):
                    delattr(diffusion_model, 'previous_modulated_input')
                if hasattr(diffusion_model, 'teacache_unet_hidden_states_residual'):
                    delattr(diffusion_model, 'teacache_unet_hidden_states_residual')
            
            current_percent = current_step_index / (len(sigmas) - 1)
            transformer_options["current_percent"] = current_percent
            if start_percent <= current_percent <= end_percent:
                transformer_options["enable_teacache"] = True
            else:
                transformer_options["enable_teacache"] = False
                
            with context:
                return model_function(input, timestep, **c)

        # Compose with any existing wrapper (TeaCache as outer wrapper; preserves existing wrappers)
        prev_wrapper = new_model.model_options.get("model_function_wrapper", None) if isinstance(getattr(new_model, "model_options", None), dict) else None
        if prev_wrapper is not None:
            def composed_wrapper(model_function, kwargs):
                return unet_wrapper_function(
                    lambda _input, _timestep, **_c: prev_wrapper(model_function, {"input": _input, "timestep": _timestep, "c": _c}),
                    kwargs
                )
            new_model.set_model_unet_function_wrapper(composed_wrapper)
        else:
            new_model.set_model_unet_function_wrapper(unet_wrapper_function)

        return new_model
    
    def _apply_fbcache(self, model, object_to_patch, residual_diff_threshold, max_consecutive_cache_hits, start, end):
        """应用FBCache优化"""
        if residual_diff_threshold <= 0.0 or max_consecutive_cache_hits == 0:
            self.log(f"residual_diff_threshold={residual_diff_threshold} 或 max_consecutive_cache_hits={max_consecutive_cache_hits}，跳过 FBCache 优化", "info")
            return model

        patch_get_output_data()

        using_validation = max_consecutive_cache_hits >= 0 or start > 0 or end < 1
        if using_validation:
            model_sampling = model.get_model_object("model_sampling")
            start_sigma, end_sigma = (float(
                model_sampling.percent_to_sigma(pct)) for pct in (start, end))
            del model_sampling

            @torch.compiler.disable()
            def validate_use_cache(use_cached):
                nonlocal consecutive_cache_hits
                use_cached = use_cached and end_sigma <= current_timestep <= start_sigma
                use_cached = use_cached and (max_consecutive_cache_hits < 0
                                             or consecutive_cache_hits
                                             < max_consecutive_cache_hits)
                consecutive_cache_hits = consecutive_cache_hits + 1 if use_cached else 0
                return use_cached
        else:
            validate_use_cache = None

        prev_timestep = None
        prev_input_state = None
        current_timestep = None
        consecutive_cache_hits = 0

        def reset_cache_state():
            nonlocal prev_input_state, prev_timestep, consecutive_cache_hits
            prev_input_state = prev_timestep = None
            consecutive_cache_hits = 0
            set_current_cache_context(create_cache_context())

        def ensure_cache_state(model_input: torch.Tensor, timestep: float):
            nonlocal current_timestep
            input_state = (model_input.shape, model_input.dtype, model_input.device)
            cache_context = get_current_cache_context()
            need_reset = (
                prev_timestep is None or
                prev_input_state is None or
                prev_input_state[1:] != input_state[1:] or
                prev_input_state[0][1:] != input_state[0][1:] or
                cache_context is None or
                timestep > prev_timestep
            )
            if need_reset:
                reset_cache_state()
            elif timestep == prev_timestep:
                cache_context.sequence_num += 1
            elif timestep < prev_timestep:
                cache_context.sequence_num = 0
            current_timestep = timestep

        def update_cache_state(model_input: torch.Tensor, timestep: float):
            nonlocal prev_timestep, prev_input_state
            prev_timestep = timestep
            prev_input_state = (model_input.shape, model_input.dtype, model_input.device)

        model = model.clone()
        diffusion_model = model.get_model_object(object_to_patch)
        
        if diffusion_model is None:
            alternative_names = ["transformer", "model"]
            for alt_name in alternative_names:
                potential_model = model.get_model_object(alt_name)
                if potential_model is not None:
                    if hasattr(potential_model, "double_blocks") or \
                       hasattr(potential_model, "transformer_blocks"):
                        diffusion_model = potential_model
                        break
                    if potential_model.__class__.__name__ == "Flux":
                        diffusion_model = potential_model
                        break
        
        if diffusion_model is None:
            # Provide helpful error message
            available_objects = []
            try:
                # Try to get available object names from the model
                if hasattr(model, 'model_keys'):
                    available_objects = list(model.model_keys())
                elif hasattr(model, 'patcher'):
                    if hasattr(model.patcher, 'model'):
                        available_objects = [attr for attr in dir(model.patcher.model) 
                                           if not attr.startswith('_')]
            except:
                pass
            
            error_msg = (
                f"Could not find diffusion model with object_to_patch='{object_to_patch}'. "
                f"For SDNQ quantized Flux models, try using 'transformer' as object_to_patch. "
                f"Available objects: {available_objects[:10] if available_objects else 'unknown'}"
            )
            raise ValueError(error_msg)

        # Supported models with specialized patches:
        # - UNetModel: SDXL, SD3.5, etc.
        # - Flux: FLUX.1-dev, FLUX.2-klein-4b, FLUX.2-klein-9b, etc.
        if diffusion_model.__class__.__name__ in ("UNetModel", "Flux"):

            if diffusion_model.__class__.__name__ == "UNetModel":
                create_patch_function = create_patch_unet_model__forward
            elif diffusion_model.__class__.__name__ == "Flux":
                # Supports all FLUX variants including FLUX.1-dev, FLUX.2-klein-4b, FLUX.2-klein-9b
                create_patch_function = create_patch_flux_forward_orig
            else:
                raise ValueError(
                    f"Unsupported model {diffusion_model.__class__.__name__}")

            patch_forward = create_patch_function(
                diffusion_model,
                residual_diff_threshold=residual_diff_threshold,
                validate_can_use_cache_function=validate_use_cache,
            )

            def model_unet_function_wrapper(model_function, kwargs):
                try:
                    input = kwargs["input"]
                    timestep = kwargs["timestep"]
                    c = kwargs["c"]
                    t = timestep[0].item()

                    ensure_cache_state(input, t)

                    with patch_forward():
                        result = model_function(input, timestep, **c)
                        update_cache_state(input, t)
                        return result
                except Exception as exc:
                    reset_cache_state()
                    raise exc from None
        else:
            # Generic adapter for models with transformer blocks structure
            # Supports: LTXV, HunyuanVideo, Anima, and other transformer-based models
            if diffusion_model is None:
                raise ValueError(
                    f"diffusion_model is None. This should not happen after initial checks. "
                    f"object_to_patch='{object_to_patch}'"
                )
            
            is_non_native_ltxv = False
            if diffusion_model.__class__.__name__ == "LTXVTransformer3D":
                is_non_native_ltxv = True
                diffusion_model = diffusion_model.transformer

            # Special handling for Anima model - it might have nested structure
            is_anima = diffusion_model.__class__.__name__ == "Anima"
            if is_anima:
                # Try to find the actual transformer model inside Anima
                if hasattr(diffusion_model, "model"):
                    potential_model = getattr(diffusion_model, "model")
                    if hasattr(potential_model, "transformer_blocks") or \
                       hasattr(potential_model, "double_blocks") or \
                       hasattr(potential_model, "joint_blocks") or \
                       hasattr(potential_model, "blocks"):
                        diffusion_model = potential_model
                elif hasattr(diffusion_model, "transformer"):
                    potential_model = getattr(diffusion_model, "transformer")
                    if hasattr(potential_model, "transformer_blocks") or \
                       hasattr(potential_model, "double_blocks") or \
                       hasattr(potential_model, "joint_blocks") or \
                       hasattr(potential_model, "blocks"):
                        diffusion_model = potential_model

            double_blocks_name = None
            single_blocks_name = None
            # Try to find the transformer blocks attribute
            possible_block_names = [
                "transformer_blocks",
                "double_blocks",
                "joint_blocks",
                "blocks",
                "transformer",
                "layers",
            ]
            
            for attr_name in possible_block_names:
                if hasattr(diffusion_model, attr_name):
                    attr_value = getattr(diffusion_model, attr_name)
                    # Check if it's a ModuleList or similar iterable with blocks
                    if isinstance(attr_value, (torch.nn.ModuleList, list, torch.nn.Sequential)) and len(attr_value) > 0:
                        double_blocks_name = attr_name
                        break
            
            if double_blocks_name is None:
                # Provide helpful debug information
                available_attrs = [attr for attr in dir(diffusion_model) 
                                  if not attr.startswith('_') and 
                                  isinstance(getattr(diffusion_model, attr, None), 
                                           (torch.nn.ModuleList, list, torch.nn.Sequential))]
                error_msg = (
                    f"No double blocks found for {diffusion_model.__class__.__name__}. "
                    f"Available module-like attributes: {available_attrs}"
                )
                raise ValueError(error_msg)

            if hasattr(diffusion_model, "single_blocks"):
                single_blocks_name = "single_blocks"

            if is_non_native_ltxv:
                original_create_skip_layer_mask = getattr(
                    diffusion_model, "create_skip_layer_mask", None)
                if original_create_skip_layer_mask is not None:
                    def new_create_skip_layer_mask(self, *args, **kwargs):
                        raise RuntimeError(
                            "STG is not supported with FBCache yet")

                    diffusion_model.create_skip_layer_mask = new_create_skip_layer_mask.__get__(
                        diffusion_model)

            # Check if this is an Anima model (or similar model that uses three positional args)
            model_class_name = diffusion_model.__class__.__name__
            has_timestep_embedding_arg = is_anima or model_class_name in ["Anima", "CosmosPredict2"]
            # Anima models return only hidden_states (single tensor), not a tuple
            is_anima_model = has_timestep_embedding_arg
            
            cached_transformer_blocks = torch.nn.ModuleList([
                CachedTransformerBlocks(
                    None if double_blocks_name is None else getattr(
                        diffusion_model, double_blocks_name),
                    None if single_blocks_name is None else getattr(
                        diffusion_model, single_blocks_name),
                    residual_diff_threshold=residual_diff_threshold,
                    validate_can_use_cache_function=validate_use_cache,
                    cat_hidden_states_first=model_class_name == "HunyuanVideo",
                    return_hidden_states_only=model_class_name == "LTXVModel" or is_non_native_ltxv or is_anima_model,
                    clone_original_hidden_states=model_class_name == "LTXVModel",
                    return_hidden_states_first=model_class_name != "OpenAISignatureMMDITWrapper",
                    accept_hidden_states_first=model_class_name != "OpenAISignatureMMDITWrapper",
                    has_timestep_embedding_arg=has_timestep_embedding_arg,
                )
            ])
            dummy_single_transformer_blocks = torch.nn.ModuleList()

            def model_unet_function_wrapper(model_function, kwargs):
                try:
                    input = kwargs["input"]
                    timestep = kwargs["timestep"]
                    c = kwargs["c"]
                    t = timestep[0].item()

                    ensure_cache_state(input, t)

                    with unittest.mock.patch.object(
                            diffusion_model,
                            double_blocks_name,
                            cached_transformer_blocks,
                    ), unittest.mock.patch.object(
                            diffusion_model,
                            single_blocks_name,
                            dummy_single_transformer_blocks,
                    ) if single_blocks_name is not None else contextlib.nullcontext(
                    ):
                        result = model_function(input, timestep, **c)
                        update_cache_state(input, t)
                        return result
                except Exception as exc:
                    reset_cache_state()
                    raise exc from None

        # Check if model is SDNQModelWrapper (doesn't have set_model_unet_function_wrapper)
        is_sdnq_wrapper = model.__class__.__name__ == "SDNQModelWrapper" or \
                         (not hasattr(model, "set_model_unet_function_wrapper") and 
                          hasattr(model, "get_pipeline") and hasattr(model, "get_model_object"))
        
        if is_sdnq_wrapper:
            # For SDNQ models, we need to patch the pipeline's transformer/unet forward directly
            pipeline = model.get_pipeline()
            transformer_or_unet = getattr(pipeline, "transformer", None) or getattr(pipeline, "unet", None)
            
            if transformer_or_unet is None:
                raise ValueError(
                    f"SDNQModelWrapper pipeline does not have 'transformer' or 'unet' attribute. "
                    f"Available attributes: {[attr for attr in dir(pipeline) if not attr.startswith('_')]}"
                )
            
            # Determine which patching strategy to use based on the transformer/unet type
            model_class_name = transformer_or_unet.__class__.__name__
            use_unet_flux_patch = model_class_name in ("UNetModel", "Flux")
            
            if use_unet_flux_patch:
                # Use the same patch as UNetModel/Flux
                if model_class_name == "UNetModel":
                    create_patch_function = create_patch_unet_model__forward
                elif model_class_name == "Flux":
                    create_patch_function = create_patch_flux_forward_orig
                else:
                    raise ValueError(f"Unsupported model {model_class_name}")
                
                patch_forward = create_patch_function(
                    transformer_or_unet,
                    residual_diff_threshold=residual_diff_threshold,
                    validate_can_use_cache_function=validate_use_cache,
                )
            else:
                # For transformer-based models, we need to set up the cached blocks
                double_blocks_name = None
                single_blocks_name = None
                possible_block_names = [
                    "transformer_blocks",
                    "double_blocks",
                    "joint_blocks",
                    "blocks",
                    "transformer",
                    "layers",
                ]
                
                for attr_name in possible_block_names:
                    if hasattr(transformer_or_unet, attr_name):
                        attr_value = getattr(transformer_or_unet, attr_name)
                        if isinstance(attr_value, (torch.nn.ModuleList, list, torch.nn.Sequential)) and len(attr_value) > 0:
                            double_blocks_name = attr_name
                            break
                
                if double_blocks_name is None:
                    available_attrs = [attr for attr in dir(transformer_or_unet) 
                                      if not attr.startswith('_') and 
                                      isinstance(getattr(transformer_or_unet, attr, None), 
                                               (torch.nn.ModuleList, list, torch.nn.Sequential))]
                    error_msg = (
                        f"No double blocks found for {model_class_name}. "
                        f"Available module-like attributes: {available_attrs}"
                    )
                    raise ValueError(error_msg)
                
                if hasattr(transformer_or_unet, "single_blocks"):
                    single_blocks_name = "single_blocks"
                
                is_anima = model_class_name == "Anima"
                has_timestep_embedding_arg = is_anima or model_class_name in ["Anima", "CosmosPredict2"]
                is_anima_model = has_timestep_embedding_arg
                
                cached_transformer_blocks = torch.nn.ModuleList([
                    CachedTransformerBlocks(
                        None if double_blocks_name is None else getattr(
                            transformer_or_unet, double_blocks_name),
                        None if single_blocks_name is None else getattr(
                            transformer_or_unet, single_blocks_name),
                        residual_diff_threshold=residual_diff_threshold,
                        validate_can_use_cache_function=validate_use_cache,
                        cat_hidden_states_first=model_class_name == "HunyuanVideo",
                        return_hidden_states_only=model_class_name == "LTXVModel" or is_anima_model,
                        clone_original_hidden_states=model_class_name == "LTXVModel",
                        return_hidden_states_first=model_class_name != "OpenAISignatureMMDITWrapper",
                        accept_hidden_states_first=model_class_name != "OpenAISignatureMMDITWrapper",
                        has_timestep_embedding_arg=has_timestep_embedding_arg,
                    )
                ])
                dummy_single_transformer_blocks = torch.nn.ModuleList()
            
            # Store original forward method
            if not hasattr(transformer_or_unet, "_fbcache_original_forward"):
                transformer_or_unet._fbcache_original_forward = transformer_or_unet.forward
            
            original_forward = transformer_or_unet._fbcache_original_forward
            
            def wrapped_forward(self_wrapped, *args, **kwargs):
                # Extract input and timestep from args/kwargs
                try:
                    if len(args) >= 2:
                        input_tensor = args[0]
                        timestep = args[1]
                    else:
                        input_tensor = kwargs.get("hidden_states") or kwargs.get("sample")
                        timestep = kwargs.get("timestep")
                    
                    if timestep is not None:
                        if isinstance(timestep, torch.Tensor):
                            t = timestep[0].item() if timestep.numel() > 0 else 0.0
                        else:
                            t = float(timestep)
                    else:
                        t = 0.0
                    
                    ensure_cache_state(input_tensor, t)
                    
                    # Call the original forward with the appropriate patch context
                    if use_unet_flux_patch:
                        with patch_forward():
                            result = original_forward(*args, **kwargs)
                    else:
                        # For transformer-based models, use the mock patch approach
                        with unittest.mock.patch.object(
                                transformer_or_unet,
                                double_blocks_name,
                                cached_transformer_blocks,
                        ), unittest.mock.patch.object(
                                transformer_or_unet,
                                single_blocks_name,
                                dummy_single_transformer_blocks,
                        ) if single_blocks_name is not None else contextlib.nullcontext():
                            result = original_forward(*args, **kwargs)
                    
                    update_cache_state(input_tensor, t)
                    return result
                except Exception as exc:
                    reset_cache_state()
                    raise exc from None
            
            # Patch the forward method
            transformer_or_unet.forward = wrapped_forward.__get__(transformer_or_unet, transformer_or_unet.__class__)
            
            # Store reference to allow cleanup if needed
            model._fbcache_patched = True
            model._fbcache_patched_component = transformer_or_unet
        else:
            # Standard ComfyUI ModelPatcher - use the wrapper method (compose with existing wrappers)
            prev_wrapper = model.model_options.get("model_function_wrapper", None) if isinstance(getattr(model, "model_options", None), dict) else None
            if prev_wrapper is not None:
                def composed_wrapper(model_function, kwargs):
                    return model_unet_function_wrapper(
                        lambda _input, _timestep, **_c: prev_wrapper(model_function, {"input": _input, "timestep": _timestep, "c": _c}),
                        kwargs
                    )
                model.set_model_unet_function_wrapper(composed_wrapper)
            else:
                model.set_model_unet_function_wrapper(model_unet_function_wrapper)
        
        return model

