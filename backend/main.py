import warnings
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', message='.*NotOpenSSLWarning.*')

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import uvicorn

# Monkeypatch for huggingface_hub compatibility issue
import huggingface_hub
import huggingface_hub.file_download
try:
    if not hasattr(huggingface_hub, "cached_download"):
        huggingface_hub.cached_download = huggingface_hub.hf_hub_download
    if not hasattr(huggingface_hub.file_download, "cached_download"):
        huggingface_hub.file_download.cached_download = huggingface_hub.hf_hub_download
except (ImportError, AttributeError):
    pass

from processor import remove_watermark, resize_image

app = FastAPI()

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/remove-watermark")
async def process_image(
    image: UploadFile = File(...),
    mask: UploadFile = File(None),
    mode: str = Form("simple"),
    sub_mode: str = Form("text"),
    quality: str = Form("standard")
):
    image_bytes = await image.read()
    mask_bytes = await mask.read() if mask else None
    
    result_bytes = remove_watermark(image_bytes, mask_bytes, mode=mode, sub_mode=sub_mode, quality=quality)
    
    return Response(content=result_bytes, media_type="image/png")

@app.post("/resize-image")
async def resize_image_api(
    image: UploadFile = File(...),
    scale: str = Form(None),
    width: str = Form(None),
    height: str = Form(None)
):
    image_bytes = await image.read()
    
    # Parse parameters
    scale_val = float(scale) if scale and scale != "null" else None
    width_val = int(width) if width and width != "null" else None
    height_val = int(height) if height and height != "null" else None
    
    try:
        result_bytes = resize_image(image_bytes, scale=scale_val, width=width_val, height=height_val)
        return Response(content=result_bytes, media_type="image/png")
    except Exception as e:
        return Response(content=str(e), status_code=500)




if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
