"""Temporary file: verify embedded vs upstream torch_transfer_utils."""
import sys, os
sys.path.insert(0, "e:/ComfyUI_windows_portable/ComfyUI/custom_nodes/ComfyUI-Magic-Assistant")
from core import klein_wrapper as kw

def strip_docstring(src):
    """Remove the docstring header so we compare from the real content."""
    lines = src.split('\n')
    # Find first non-empty line after the first line
    start = 0
    for i, l in enumerate(lines[1:], 1):
        if l.strip():
            start = i
            break
    return '\n'.join(lines[start:])

embedded_torch = strip_docstring(kw._TORCH_TRANSFER_UTILS_SOURCE)
embedded_tf = strip_docstring(kw._TRANSFORMER_FLUX2_SOURCE)

# Print first 50 lines of each to compare structure
print("=== torch_transfer_utils first 20 lines ===")
for i, l in enumerate(embedded_torch.split('\n')[:20]):
    print(f"{i:3}: {repr(l[:100])}")

print()
print("=== transformer_flux2 first 20 lines ===")
for i, l in enumerate(embedded_tf.split('\n')[:20]):
    print(f"{i:3}: {repr(l[:100])}")

# Also print the last 20 lines of transformer_flux2
print()
print("=== transformer_flux2 last 20 lines ===")
tl = embedded_tf.split('\n')
for i, l in enumerate(tl[-20:], len(tl)-20):
    print(f"{i:3}: {repr(l[:100])}")
