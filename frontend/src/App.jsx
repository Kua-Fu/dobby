import React, { useState } from 'react';
import ImageEditor from './components/ImageEditor';
import { Upload, Download, RefreshCw, Sparkles } from 'lucide-react';

function App() {
    const [activeFile, setActiveFile] = useState(null); // Current working file
    const [originalImage, setOriginalImage] = useState(null); // Backup for reset
    const [resultImage, setResultImage] = useState(null); // Display URL
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAiMode, setIsAiMode] = useState(false);
    const [subMode, setSubMode] = useState('text'); // 'text' or 'smart'
    const [quality, setQuality] = useState('standard'); // 'standard' or 'ultra'
    const [zoomScale, setZoomScale] = useState(1); // 1 = 100%
    const [brushSize, setBrushSize] = useState(25);
    const [processingTime, setProcessingTime] = useState(null);
    const editorRef = React.useRef(null);

    // Resize states
    const [resizeMode, setResizeMode] = useState('scale'); // 'scale' or 'dimension'
    const [targetScale, setTargetScale] = useState(100);
    const [targetWidth, setTargetWidth] = useState(0);
    const [targetHeight, setTargetHeight] = useState(0);
    const [lockAspectRatio, setLockAspectRatio] = useState(true);
    const [originalDimensions, setOriginalDimensions] = useState({ width: 0, height: 0 });

    // Sync display URL and dimensions with activeFile
    React.useEffect(() => {
        if (activeFile) {
            const url = URL.createObjectURL(activeFile);
            setResultImage(url);

            const img = new Image();
            img.onload = () => {
                setOriginalDimensions({ width: img.width, height: img.height });
                setTargetWidth(img.width);
                setTargetHeight(img.height);
            };
            img.src = url;

            return () => URL.revokeObjectURL(url);
        } else {
            setResultImage(null);
        }
    }, [activeFile]);

    const handleUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setOriginalImage(file);
            setActiveFile(file);
        }
    };

    // AI mode: direct processing without manual masking
    const processImageAI = async () => {
        if (!activeFile) return;
        setIsProcessing(true);
        setProcessingTime(null);
        const startTime = performance.now();
        const formData = new FormData();
        formData.append('image', activeFile);
        formData.append('mode', 'ai');
        formData.append('sub_mode', subMode);
        formData.append('quality', quality);

        try {
            const response = await fetch('http://localhost:8000/remove-watermark', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const blob = await response.blob();
                setActiveFile(blob);
                const endTime = performance.now();
                setProcessingTime(Math.round(endTime - startTime));
            } else {
                alert('处理失败，请检查后端服务是否已启动');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('连接后端服务出错');
        } finally {
            setIsProcessing(false);
        }
    };

    // Normal mode: manual masking
    const processImageNormal = async (maskBlob) => {
        if (!activeFile) return;
        setIsProcessing(true);
        setProcessingTime(null);
        const startTime = performance.now();
        const formData = new FormData();
        formData.append('image', activeFile);
        formData.append('mask', maskBlob, 'mask.png');
        formData.append('mode', 'simple');

        try {
            const response = await fetch('http://localhost:8000/remove-watermark', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const blob = await response.blob();
                setActiveFile(blob);
                const endTime = performance.now();
                setProcessingTime(Math.round(endTime - startTime));
            } else {
                alert('处理失败，请检查后端服务是否已启动');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('连接后端服务出错');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = resultImage;
        link.download = '已处理图片.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const resetAll = () => {
        setOriginalImage(null);
        setActiveFile(null);
        setZoomScale(1);
        setOriginalDimensions({ width: 0, height: 0 });
        setTargetWidth(0);
        setTargetHeight(0);
        setTargetScale(100);
        setResizeMode('scale');
        setLockAspectRatio(true);
    };

    const revertToOriginal = () => {
        if (originalImage) {
            setActiveFile(originalImage);
            setZoomScale(1);
        }
    };

    const handleZoom = (delta) => {
        setZoomScale(prev => Math.min(Math.max(prev + delta, 0.1), 5));
    };

    const resetZoom = () => {
        setZoomScale(1);
    };

    const handleResize = async () => {
        if (!activeFile) return;
        setIsProcessing(true);
        setProcessingTime(null);
        const startTime = performance.now();

        try {
            const formData = new FormData();
            formData.append('image', activeFile);

            if (resizeMode === 'scale') {
                formData.append('scale', targetScale / 100);
            } else {
                formData.append('width', targetWidth);
                formData.append('height', targetHeight);
            }

            const response = await fetch('http://127.0.0.1:8000/resize-image', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const blob = await response.blob();
                setActiveFile(blob);
                const endTime = performance.now();
                setProcessingTime(Math.round(endTime - startTime));
            } else {
                console.error('Resize failed');
                alert('调整尺寸失败，请重试');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('服务器连接失败');
        } finally {
            setIsProcessing(false);
        }
    };

    const updateDimension = (type, value) => {
        // Handle empty input
        if (value === '') {
            if (type === 'width') setTargetWidth('');
            else setTargetHeight('');
            return;
        }

        const numValue = parseInt(value, 10);
        if (isNaN(numValue)) return;

        if (type === 'width') {
            setTargetWidth(numValue);
            if (lockAspectRatio && originalDimensions.width > 0) {
                const ratio = originalDimensions.height / originalDimensions.width;
                setTargetHeight(Math.round(numValue * ratio));
            }
        } else {
            setTargetHeight(numValue);
            if (lockAspectRatio && originalDimensions.height > 0) {
                const ratio = originalDimensions.width / originalDimensions.height;
                setTargetWidth(Math.round(numValue * ratio));
            }
        }
    };

    return (
        <div className="container">
            <header>
                <h1>PureClear AI</h1>
                <p className="subtitle">利用智能算法，轻松去除图片水印</p>
                <div className="ai-toggle-wrapper">
                    <span className={!isAiMode ? 'active' : ''}>普通模式</span>
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={isAiMode}
                            onChange={(e) => setIsAiMode(e.target.checked)}
                        />
                        <span className="slider round"></span>
                    </label>
                    <span className={isAiMode ? 'active' : ''}>AI 高级模式</span>
                </div>
            </header>

            <main className="editor-layout">
                <div className="left-panel">
                    {!activeFile ? (
                        <label className="upload-card">
                            <input type="file" hidden onChange={handleUpload} accept="image/*" />
                            <Upload size={48} color="#6366f1" style={{ marginBottom: '1rem' }} />
                            <h3>上传图片</h3>
                            <p className="subtitle">点击或拖拽图片到此处</p>
                        </label>
                    ) : (
                        <div className="image-viewport">
                            <div className="zoom-controls">
                                <button onClick={() => handleZoom(-0.1)}>-</button>
                                <span>比例: {Math.round(zoomScale * 100)}%</span>
                                <button onClick={() => handleZoom(0.1)}>+</button>
                                <button onClick={resetZoom} className="btn-small">重置比例</button>
                            </div>

                            {isAiMode ? (
                                <div className="image-container" style={{ transform: `scale(${zoomScale})`, transformOrigin: 'top center' }}>
                                    <img
                                        src={resultImage}
                                        alt="Current"
                                        className="preview-image"
                                    />
                                </div>
                            ) : (
                                <ImageEditor
                                    ref={editorRef}
                                    image={activeFile}
                                    onProcess={processImageNormal}
                                    isProcessing={isProcessing}
                                    brushSize={brushSize}
                                />
                            )}
                        </div>
                    )}
                </div>

                {activeFile && (
                    <div className="right-panel">
                        <div className="options-group">
                            <h4>处理模式</h4>
                            <div className="ai-toggle-wrapper sidebar-toggle">
                                <span className={!isAiMode ? 'active' : ''}>基础模式</span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={isAiMode}
                                        onChange={(e) => setIsAiMode(e.target.checked)}
                                    />
                                    <span className="slider round"></span>
                                </label>
                                <span className={isAiMode ? 'active' : ''}>AI 加速</span>
                            </div>
                        </div>

                        {!isAiMode && (
                            <div className="options-group">
                                <h4>画笔设置</h4>
                                <div className="brush-size">
                                    <input
                                        type="range"
                                        min="5"
                                        max="100"
                                        value={brushSize}
                                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                    />
                                    <span className="hint-text">{brushSize}px</span>
                                </div>
                            </div>
                        )}

                        {isAiMode && (
                            <>
                                <div className="options-group">
                                    <h4>检测算法</h4>
                                    <div className="sub-mode-selector vertical">
                                        <button
                                            className={`sub-mode-btn ${subMode === 'text' ? 'active' : ''}`}
                                            onClick={() => setSubMode('text')}
                                        >
                                            文本检测 (EasyOCR)
                                        </button>
                                        <button
                                            className={`sub-mode-btn ${subMode === 'smart' ? 'active' : ''}`}
                                            onClick={() => setSubMode('smart')}
                                        >
                                            智能检测 (Florence-2)
                                        </button>
                                    </div>
                                </div>

                                <div className="options-group">
                                    <h4>修复质量</h4>
                                    <div className="quality-options">
                                        <button
                                            className={`quality-btn ${quality === 'standard' ? 'active' : ''}`}
                                            onClick={() => setQuality('standard')}
                                        >
                                            标准
                                        </button>
                                        <button
                                            className={`quality-btn ${quality === 'ultra' ? 'active' : ''}`}
                                            onClick={() => setQuality('ultra')}
                                        >
                                            极致 (SAM 2)
                                        </button>
                                    </div>
                                    <p className="hint-text">
                                        {quality === 'ultra' ? '✨ 使用 SAM 2 像素级遮罩' : '⚡ 快速修复'}
                                    </p>
                                </div>
                            </>
                        )}

                        <div className="options-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                            <h4>图片尺寸调整</h4>
                            <div className="sub-mode-selector">
                                <button
                                    className={`sub-mode-btn ${resizeMode === 'scale' ? 'active' : ''}`}
                                    onClick={() => setResizeMode('scale')}
                                    style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                                >
                                    按比例
                                </button>
                                <button
                                    className={`sub-mode-btn ${resizeMode === 'dimension' ? 'active' : ''}`}
                                    onClick={() => setResizeMode('dimension')}
                                    style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                                >
                                    按像素
                                </button>
                            </div>

                            {resizeMode === 'scale' ? (
                                <div className="brush-size">
                                    <input
                                        type="range"
                                        min="1"
                                        max="200"
                                        value={targetScale}
                                        onChange={(e) => setTargetScale(parseInt(e.target.value))}
                                    />
                                    <span className="hint-text">{targetScale}%</span>
                                </div>
                            ) : (
                                <div className="dimension-inputs">
                                    <div className="input-group">
                                        <label>宽</label>
                                        <input
                                            type="number"
                                            value={targetWidth}
                                            onChange={(e) => updateDimension('width', e.target.value)}
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label>高</label>
                                        <input
                                            type="number"
                                            value={targetHeight}
                                            onChange={(e) => updateDimension('height', e.target.value)}
                                        />
                                    </div>
                                    <label className="checkbox-label" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={lockAspectRatio}
                                            onChange={(e) => setLockAspectRatio(e.target.checked)}
                                        /> 锁定长宽比
                                    </label>
                                </div>
                            )}

                            <button className="btn-primary full-width" onClick={handleResize} disabled={isProcessing} style={{ marginTop: '0.5rem' }}>
                                {isProcessing ? '处理中...' : '应用调整'}
                            </button>
                        </div>

                        <div className="action-buttons">
                            {/* Always show action buttons */}
                            {isAiMode && (
                                <button className="btn-primary full-width" onClick={processImageAI} disabled={isProcessing}>
                                    {isProcessing ? '处理中...' : '开始 AI 去水印'}
                                </button>
                            )}

                            {!isAiMode && (
                                <>
                                    <button
                                        className="btn-primary full-width"
                                        onClick={() => editorRef.current?.handleProcess()}
                                        disabled={isProcessing}
                                    >
                                        {isProcessing ? '处理中...' : '开始去水印'}
                                    </button>
                                    <button
                                        className="btn-secondary full-width"
                                        onClick={() => editorRef.current?.handleClear()}
                                    >
                                        清除涂抹
                                    </button>
                                </>
                            )}

                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                <button className="btn-primary full-width" onClick={handleDownload} disabled={!resultImage}>
                                    <Download size={18} style={{ marginRight: '0.5rem' }} />
                                    下载当前结果
                                </button>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button className="btn-secondary full-width" onClick={revertToOriginal} disabled={!originalImage}>
                                        恢复原图
                                    </button>
                                    <button className="btn-secondary full-width" onClick={resetAll}>
                                        <RefreshCw size={18} style={{ marginRight: '0.5rem' }} />
                                        清空
                                    </button>
                                </div>
                                {processingTime && (
                                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                        处理耗时: <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{processingTime}</span> ms
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <p>© 2026 PureClear AI. 由 OpenCV 驱动</p>
            </footer>
        </div>
    );
}

export default App;
