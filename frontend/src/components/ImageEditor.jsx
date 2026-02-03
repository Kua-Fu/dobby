import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';

const ImageEditor = forwardRef(({ image, onProcess, isProcessing, brushSize }, ref) => {
    const canvasRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [ctx, setCtx] = useState(null);
    const [maskCtx, setMaskCtx] = useState(null);

    useImperativeHandle(ref, () => ({
        handleClear: () => {
            const canvas = canvasRef.current;
            const maskCanvas = maskCanvasRef.current;
            const context = canvas.getContext('2d');
            const mContext = maskCanvas.getContext('2d');

            const img = new Image();
            img.onload = () => {
                context.drawImage(img, 0, 0, canvas.width, canvas.height);
                mContext.fillStyle = 'black';
                mContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
            };
            img.src = URL.createObjectURL(image);
        },
        handleProcess: () => {
            maskCanvasRef.current.toBlob((blob) => {
                onProcess(blob);
            }, 'image/png');
        }
    }));

    useEffect(() => {
        if (image && canvasRef.current) {
            const canvas = canvasRef.current;
            const maskCanvas = maskCanvasRef.current;
            const context = canvas.getContext('2d');
            const mContext = maskCanvas.getContext('2d');

            const img = new Image();
            img.onload = () => {
                const maxWidth = 800;
                const maxHeight = 600;
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    width = (maxHeight / height) * width;
                    height = maxHeight;
                }

                canvas.width = width;
                canvas.height = height;
                maskCanvas.width = width;
                maskCanvas.height = height;

                context.drawImage(img, 0, 0, width, height);
                mContext.fillStyle = 'black';
                mContext.fillRect(0, 0, width, height);

                setCtx(context);
                setMaskCtx(mContext);
            };
            img.src = URL.createObjectURL(image);
        }
    }, [image]);

    const startDrawing = (e) => {
        setIsDrawing(true);
        draw(e);
    };

    const endDrawing = () => {
        setIsDrawing(false);
        ctx.beginPath();
        maskCtx.beginPath();
    };

    const draw = (e) => {
        if (!isDrawing) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);

        maskCtx.lineWidth = brushSize;
        maskCtx.lineCap = 'round';
        maskCtx.strokeStyle = 'white';
        maskCtx.lineTo(x, y);
        maskCtx.stroke();
        maskCtx.beginPath();
        maskCtx.moveTo(x, y);
    };

    return (
        <div className="editor-container">
            <div className="canvas-wrapper">
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={endDrawing}
                    onMouseOut={endDrawing}
                />
                <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
            </div>
            <p className="subtitle" style={{ marginTop: '1rem' }}>涂抹图片中的水印区域</p>
        </div>
    );
});

export default ImageEditor;
