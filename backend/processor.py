import cv2
import numpy as np
from PIL import Image
import io
import torch
from iopaint.model_manager import ModelManager
from iopaint.schema import InpaintRequest, Device

# Global model manager to avoid reloading
model_manager = None
ocr_reader = None
florence_model = None
florence_processor = None
sam_predictor = None

def get_model():
    global model_manager
    if model_manager is None:
        try:
            device = Device.cuda if torch.cuda.is_available() else Device.cpu
            # Use 'lama' as default high-quality model
            model_manager = ModelManager(name="lama", device=device)
        except Exception as e:
            print(f"Error loading AI model: {e}")
            # Fallback to cv2 if lama fails
            # We set it to None to trigger the manual cv2 fallback in remove_watermark
            # which correctly handles BGR/RGB to avoid color inversion
            print("Lama model not found, will use internal OpenCV fallback")
            model_manager = None
    return model_manager

def get_sam_predictor():
    """Initialize SAM 2 predictor for precise masking"""
    global sam_predictor
    if sam_predictor is None:
        try:
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            
            # Using base model for good balance between speed and quality
            model_cfg = "sam2_hiera_b+.yaml"
            sam2_checkpoint = "sam2_hiera_base_plus.pt" # Needs to be downloaded
            
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"Loading SAM 2 model on {device}...")
            # Note: In a real environment, we'd need to ensure the checkpoint exists
            # We'll add a check or a way to download it
            sam2_model = build_sam2(model_cfg, sam2_checkpoint, device=device)
            sam_predictor = SAM2ImagePredictor(sam2_model)
            print("SAM 2 predictor initialized successfully")
        except Exception as e:
            print(f"Warning: Could not initialize SAM 2: {e}")
            sam_predictor = None
    return sam_predictor

def refine_mask_with_sam(img, box_mask):
    """Use SAM 2 to refine a rough box mask into a precise pixel mask"""
    predictor = get_sam_predictor()
    if predictor is None:
        return box_mask
        
    try:
        # SAM 2 predictor expects RGB
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        predictor.set_image(img_rgb)
        
        # Find continuous regions in the box mask
        contours, _ = cv2.findContours(box_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        refined_mask = np.zeros_like(box_mask)
        
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            input_box = np.array([x, y, x + w, y + h])
            
            # Predict precise mask for this box
            masks, scores, _ = predictor.predict(
                box=input_box[None, :],
                multimask_output=False,
            )
            
            # Add to full mask
            refined_mask = cv2.bitwise_or(refined_mask, (masks[0] * 255).astype(np.uint8))
            
        # If refinement failed to catch anything, fall back to box mask
        if np.sum(refined_mask) == 0:
            return box_mask
            
        # Apply slight dilation to ensure edges are covered
        kernel = np.ones((3,3), np.uint8)
        refined_mask = cv2.dilate(refined_mask, kernel, iterations=1)
        return refined_mask
    except Exception as e:
        print(f"SAM refinement failed: {e}")
        return box_mask

def get_ocr_reader():
    """Initialize OCR reader for text detection"""
    global ocr_reader
    if ocr_reader is None:
        try:
            import easyocr
            # Support Chinese and English
            ocr_reader = easyocr.Reader(['ch_sim', 'en'], gpu=torch.cuda.is_available())
            print("OCR reader initialized successfully")
        except Exception as e:
            print(f"Warning: Could not initialize OCR reader: {e}")
            ocr_reader = None
    return ocr_reader

def get_florence_model():
    """Initialize Florence-2 model for smart detection"""
    global florence_model, florence_processor
    if florence_model is None:
        try:
            from transformers import AutoProcessor, AutoModelForCausalLM
            model_id = "microsoft/Florence-2-base"
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"Loading Florence-2 model on {device}...")
            # Use attn_implementation="eager" to avoid SDPA related errors in some versions
            florence_model = AutoModelForCausalLM.from_pretrained(
                model_id, 
                trust_remote_code=True,
                attn_implementation="eager"
            ).to(device).eval()
            florence_processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
            print("Florence-2 model loaded successfully")
        except Exception as e:
            print(f"Warning: Could not initialize Florence-2 model: {e}")
            florence_model = None
            florence_processor = None
    return florence_model, florence_processor

def detect_watermarks_florence(img):
    """Detect general watermarks using Florence-2"""
    model, processor = get_florence_model()
    if model is None:
        return None
    
    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    
    try:
        # Convert to PIL for Florence
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        # Florence-2 task for object detection/watermark detection
        # Using a generic phrase to detect watermarks or logos
        prompt = "<OD>watermark, logo, text, stamp"
        
        inputs = processor(text=prompt, images=pil_img, return_tensors="pt").to(device)
        generated_ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=1024,
            do_sample=False,
            num_beams=3
        )
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed_answer = processor.post_process_generation(generated_text, task=prompt, image_size=(pil_img.width, pil_img.height))
        
        # Parse OD results
        if prompt in parsed_answer:
            bboxes = parsed_answer[prompt]['bboxes']
            for bbox in bboxes:
                x1, y1, x2, y2 = map(int, bbox)
                # Expand slightly
                x1 = max(0, x1 - 10)
                y1 = max(0, y1 - 10)
                x2 = min(w, x2 + 10)
                y2 = min(h, y2 + 10)
                cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
                
        return mask
    except Exception as e:
        print(f"Florence detection failed: {e}")
        return None

def detect_text_regions(img):
    """
    Detect text regions in the image using multiple methods:
    1. OCR-based detection (if available)
    2. Edge detection for text-like patterns
    3. Brightness/contrast detection for watermarks
    """
    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    
    # Method 1: OCR-based text detection
    reader = get_ocr_reader()
    if reader is not None:
        try:
            # Detect text regions
            results = reader.readtext(img)
            
            for (bbox, text, prob) in results:
                if prob > 0.2:  # Lower threshold to catch more text
                    # Convert bbox to integer coordinates
                    points = np.array(bbox, dtype=np.int32)
                    
                    # Expand the bounding box MORE to ensure complete coverage
                    # This is crucial for complete text removal
                    x_min = max(0, int(points[:, 0].min()) - 15)
                    x_max = min(w, int(points[:, 0].max()) + 15)
                    y_min = max(0, int(points[:, 1].min()) - 15)
                    y_max = min(h, int(points[:, 1].max()) + 15)
                    
                    # Draw filled rectangle on mask
                    cv2.rectangle(mask, (x_min, y_min), (x_max, y_max), 255, -1)
                    print(f"Detected text: '{text}' with confidence {prob:.2f} at ({x_min},{y_min})-({x_max},{y_max})")
        except Exception as e:
            print(f"OCR detection failed: {e}")
    
    # Method 2: Detect bright/white text (common for watermarks)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Detect bright areas (white text on dark background)
    _, bright_mask = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    
    # Detect dark areas (dark text on bright background)
    _, dark_mask = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)
    
    # Combine masks
    combined_mask = cv2.bitwise_or(bright_mask, dark_mask)
    
    # Apply morphological operations to connect text regions
    kernel = np.ones((5, 5), np.uint8)
    combined_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    
    # Find contours and filter by size (remove noise)
    contours, _ = cv2.findContours(combined_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    for contour in contours:
        area = cv2.contourArea(contour)
        # Filter small noise and very large regions
        if 100 < area < (h * w * 0.3):
            x, y, w_box, h_box = cv2.boundingRect(contour)
            # Text regions usually have certain aspect ratios
            aspect_ratio = w_box / float(h_box) if h_box > 0 else 0
            if 0.1 < aspect_ratio < 20:  # Reasonable text aspect ratio
                # Expand bounding box
                x = max(0, x - 10)
                y = max(0, y - 10)
                w_box = min(w - x, w_box + 20)
                h_box = min(h - y, h_box + 20)
                cv2.rectangle(mask, (x, y), (x + w_box, y + h_box), 255, -1)
    
    # Merge OCR mask with edge-based mask and apply strong dilation
    kernel_large = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_large, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_DILATE, kernel_large, iterations=3)
    
    return mask

def remove_watermark(image_bytes, mask_bytes=None, mode="simple", sub_mode="text", quality="standard"):
    # Load image with potential alpha channel
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    
    if img is None:
        raise ValueError("Could not decode image")
        
    has_alpha = img.shape[-1] == 4
    if has_alpha:
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]
        # Use BGR for detection
        detect_img = bgr
    else:
        detect_img = img
    
    if mode == "ai":
        # AI mode: automatic detection
        print(f"Starting AI detection (Alpha Support) with sub_mode: {sub_mode}, quality: {quality}")
        
        mask = None
        if sub_mode == "smart":
            mask = detect_watermarks_florence(detect_img)
            if mask is None or np.sum(mask) == 0:
                print("Smart detection failed or found nothing, falling back to text detection")
                mask = detect_text_regions(detect_img)
        else:
            mask = detect_text_regions(detect_img)
            
        # Check if any regions were detected
        if mask is None or np.sum(mask) == 0:
            print("No regions detected, returning original image")
            is_success, buffer = cv2.imencode(".png", img)
            return io.BytesIO(buffer).read()
            
        # Apply SAM refinement if high quality requested
        if quality == "ultra":
            print("Refining mask with SAM 2...")
            mask = refine_mask_with_sam(detect_img, mask)
        
        print(f"Detection complete, mask coverage: {np.sum(mask > 0) / mask.size * 100:.2f}%")
        
        try:
            model = get_model()
            if model is None:
                raise Exception("No AI model available")
                
            if has_alpha:
                # model manager typically expects RGB
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                rgb_res = model(rgb, mask, InpaintRequest())
                bgr_res = cv2.cvtColor(rgb_res.astype(np.uint8), cv2.COLOR_RGB2BGR)
                
                # For alpha, we can use simple inpainting or just set it to 0 (transparent) 
                alpha_res = cv2.inpaint(alpha, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
                result = cv2.merge([bgr_res, alpha_res.astype(np.uint8)])
            else:
                rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                rgb_res = model(rgb, mask, InpaintRequest())
                result = cv2.cvtColor(rgb_res.astype(np.uint8), cv2.COLOR_RGB2BGR)
        except Exception as e:
            print(f"AI processing failed: {e}, falling back to OpenCV")
            if has_alpha:
                bgr_res = cv2.inpaint(bgr, mask, inpaintRadius=10, flags=cv2.INPAINT_TELEA)
                alpha_res = cv2.inpaint(alpha, mask, inpaintRadius=10, flags=cv2.INPAINT_TELEA)
                result = cv2.merge([bgr_res, alpha_res])
            else:
                result = cv2.inpaint(img, mask, inpaintRadius=10, flags=cv2.INPAINT_TELEA)
    else:
        # Normal mode: use provided mask
        if mask_bytes is None:
            raise ValueError("Mask is required for normal mode")
            
        mask_arr = np.frombuffer(mask_bytes, np.uint8)
        mask = cv2.imdecode(mask_arr, cv2.IMREAD_GRAYSCALE)
        
        # Ensure mask is the same size as image
        if img.shape[:2] != mask.shape:
            mask = cv2.resize(mask, (img.shape[1], img.shape[0]))
        
        if has_alpha:
            bgr_res = cv2.inpaint(bgr, mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
            alpha_res = cv2.inpaint(alpha, mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
            result = cv2.merge([bgr_res, alpha_res])
        else:
            result = cv2.inpaint(img, mask, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
    
    # Convert back to bytes
    is_success, buffer = cv2.imencode(".png", result)
    return io.BytesIO(buffer).read()

def resize_image(image_bytes, scale=None, width=None, height=None):
    """
    Resize image based on scale percentage or specific dimensions.
    Preserves alpha channel if present.
    """
    # Load image with potential alpha channel
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    
    if img is None:
        raise ValueError("Could not decode image")
    
    h, w = img.shape[:2]
    new_w, new_h = w, h
    
    if scale is not None and scale > 0:
        # Scale by percentage (e.g. 0.5 for 50%)
        new_w = int(w * scale)
        new_h = int(h * scale)
    elif width is not None and height is not None:
        # Scale to exact dimensions
        new_w = int(width)
        new_h = int(height)
    elif width is not None:
        # Scale width, maintain aspect ratio
        ratio = width / w
        new_w = int(width)
        new_h = int(h * ratio)
    elif height is not None:
        # Scale height, maintain aspect ratio
        ratio = height / h
        new_h = int(height)
        new_w = int(w * ratio)
        
    # Ensure minimum dimensions
    new_w = max(1, new_w)
    new_h = max(1, new_h)
    
    # Perform resizing
    # INTER_AREA is better for shrinking, INTER_LINEAR/CUBIC for enlarging
    interpolation = cv2.INTER_AREA if (new_w < w or new_h < h) else cv2.INTER_CUBIC
    resized = cv2.resize(img, (new_w, new_h), interpolation=interpolation)
    
    # Convert back to bytes
    is_success, buffer = cv2.imencode(".png", resized)
    return io.BytesIO(buffer).read()

