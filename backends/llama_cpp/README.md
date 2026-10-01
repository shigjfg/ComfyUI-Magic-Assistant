# Optional llama.cpp backend

Place a compatible `llama-server.exe` (and any required runtime DLLs) in this
folder, or select an external executable in the Magic Assistant local-model
configuration page.

This folder is optional. If it is absent, a profile configured for `llama_cpp`
automatically falls back to the official ComfyUI text-encoder generation path
(`comfy_clip`) instead of breaking the node.
