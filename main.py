import cv2
import numpy as np

def remove_watermark_simple(img_path, output_path):
    # 1. 读取图像
    img = cv2.imread(img_path)
    
    # 2. 手动定义水印位置 (y1:y2, x1:x2)
    # 假设水印在右下角，你可以根据实际情况调整坐标
    mask = np.zeros(img.shape[:2], dtype=np.uint8)
    # 示例坐标：[纵向起始:纵向结束, 横向起始:横向结束]
    mask[500:550, 400:580] = 255 

    # 3. 使用 Telea 算法进行修复
    # cv2.INPAINT_TELEA 或者 cv2.INPAINT_NS
    result = cv2.inpaint(img, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    # 4. 保存结果
    cv2.imwrite(output_path, result)
    print(f"处理完成，保存至: {output_path}")

# 使用示例
# remove_watermark_simple('ai_image.jpg', 'cleaned_image.jpg')