"""Check indentation of embedded sources."""
import sys
sys.path.insert(0, r'e:/ComfyUI_windows_portable/ComfyUI/custom_nodes/ComfyUI-Magic-Assistant')
from core import klein_wrapper as kw

# Check transformer_flux2 source
tf_src = kw._TRANSFORMER_FLUX2_SOURCE
lines = tf_src.split('\n')
print("=== transformer_flux2: first 8 lines ===")
for i, l in enumerate(lines[:8]):
    leading = len(l) - len(l.lstrip())
    print(f"  {i}: leading={leading!r}  {l[:90]!r}")

print()
# Check torch_transfer_utils source
tt_src = kw._TORCH_TRANSFER_UTILS_SOURCE
lines2 = tt_src.split('\n')
print("=== torch_transfer_utils: first 8 lines ===")
for i, l in enumerate(lines2[:8]):
    leading = len(l) - len(l.lstrip())
    print(f"  {i}: leading={leading!r}  {l[:90]!r}")

print()
# Check if _TRANSFORMER_FLUX2_SOURCE looks syntactically valid
print("=== Attempting to compile _TRANSFORMER_FLUX2_SOURCE ===")
try:
    compile(tf_src, "<_TRANSFORMER_FLUX2_SOURCE>", "exec")
    print("OK: compiles without syntax error")
except SyntaxError as e:
    print(f"SYNTAX ERROR: {e}")

print()
print("=== Attempting to compile _TORCH_TRANSFER_UTILS_SOURCE ===")
try:
    compile(tt_src, "<_TORCH_TRANSFER_UTILS_SOURCE>", "exec")
    print("OK: compiles without syntax error")
except SyntaxError as e:
    print(f"SYNTAX ERROR: {e}")
