import React, { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Trash2 } from 'lucide-react';

const PRESETS = {
    batch240: { key: 'batch240', label: '表情包', width: 240, height: 240, suffix: '240' },
    banner: { key: 'banner', label: '横幅', width: 750, height: 400, suffix: '横幅' },
    cover: { key: 'cover', label: '封面', width: 240, height: 240, suffix: '封面' },
    icon: { key: 'icon', label: '图标', width: 50, height: 50, suffix: '图标' },
};

function getBaseName(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;
}

function buildOutputName(filename, suffix) {
    return `${getBaseName(filename)}_${suffix}.png`;
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error(`无法读取图片：${file.name}`));
        };

        img.src = objectUrl;
    });
}

async function renderImageToBlob(file, preset) {
    const img = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('浏览器不支持 Canvas 绘图');
    }

    const scale = Math.min(preset.width / img.width, preset.height / img.height);
    const drawWidth = Math.max(1, Math.round(img.width * scale));
    const drawHeight = Math.max(1, Math.round(img.height * scale));
    const offsetX = Math.round((preset.width - drawWidth) / 2);
    const offsetY = Math.round((preset.height - drawHeight) / 2);

    ctx.clearRect(0, 0, preset.width, preset.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png');
    });

    if (!blob) {
        throw new Error(`导出失败：${file.name}`);
    }

    return blob;
}

function downloadResult(result) {
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function WechatStickerMaker() {
    const [images, setImages] = useState([]);
    const [selectedImageId, setSelectedImageId] = useState(null);
    const [results, setResults] = useState([]);
    const [isGenerating, setIsGenerating] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const imagesRef = useRef([]);
    const resultsRef = useRef([]);

    useEffect(() => {
        imagesRef.current = images;
    }, [images]);

    useEffect(() => {
        resultsRef.current = results;
    }, [results]);

    useEffect(() => {
        return () => {
            imagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
            resultsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
        };
    }, []);

    const selectedImage = images.find((item) => item.id === selectedImageId) || null;

    const mergeResults = (nextResults) => {
        setResults((prevResults) => {
            const nextNames = new Set(nextResults.map((item) => item.name));

            prevResults.forEach((item) => {
                if (nextNames.has(item.name)) {
                    URL.revokeObjectURL(item.url);
                }
            });

            const remaining = prevResults.filter((item) => !nextNames.has(item.name));
            return [...nextResults, ...remaining];
        });
    };

    const handleAddImages = (event) => {
        const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
        if (files.length === 0) {
            event.target.value = '';
            return;
        }

        const nextImages = files.map((file) => ({
            id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
            file,
            previewUrl: URL.createObjectURL(file),
        }));

        setImages((prevImages) => [...prevImages, ...nextImages]);
        setSelectedImageId((prevSelectedId) => prevSelectedId || nextImages[0].id);
        setErrorMessage('');
        event.target.value = '';
    };

    const removeImage = (imageId) => {
        setImages((prevImages) => {
            const nextImages = prevImages.filter((item) => item.id !== imageId);
            const removedImage = prevImages.find((item) => item.id === imageId);

            if (removedImage) {
                URL.revokeObjectURL(removedImage.previewUrl);
            }

            setSelectedImageId((prevSelectedId) => {
                if (prevSelectedId !== imageId) {
                    return prevSelectedId;
                }
                return nextImages[0]?.id || null;
            });

            return nextImages;
        });
    };

    const clearAll = () => {
        images.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        results.forEach((item) => URL.revokeObjectURL(item.url));
        setImages([]);
        setResults([]);
        setSelectedImageId(null);
        setErrorMessage('');
        setIsGenerating('');
    };

    const createResult = async (imageItem, preset) => {
        const blob = await renderImageToBlob(imageItem.file, preset);
        return {
            id: `${imageItem.id}-${preset.key}`,
            name: buildOutputName(imageItem.file.name, preset.suffix),
            sourceName: imageItem.file.name,
            sizeLabel: `${preset.width} × ${preset.height}`,
            presetLabel: preset.label,
            url: URL.createObjectURL(blob),
        };
    };

    const handleGenerateBatch = async () => {
        if (images.length === 0) {
            setErrorMessage('请先添加至少一张图片');
            return;
        }

        setIsGenerating('batch240');
        setErrorMessage('');

        try {
            const nextResults = await Promise.all(images.map((imageItem) => createResult(imageItem, PRESETS.batch240)));
            mergeResults(nextResults);
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '批量生成失败，请重试');
        } finally {
            setIsGenerating('');
        }
    };

    const handleGenerateSingle = async (presetKey) => {
        const preset = PRESETS[presetKey];
        if (!preset || !selectedImage) {
            setErrorMessage('请先从左侧选择一张图片');
            return;
        }

        setIsGenerating(presetKey);
        setErrorMessage('');

        try {
            const result = await createResult(selectedImage, preset);
            mergeResults([result]);
        } catch (error) {
            console.error(error);
            setErrorMessage(error.message || '生成失败，请重试');
        } finally {
            setIsGenerating('');
        }
    };

    const downloadAllResults = () => {
        results.forEach((result, index) => {
            window.setTimeout(() => downloadResult(result), index * 120);
        });
    };

    return (
        <main className="wechat-layout">
            <section className="wechat-panel upload-panel">
                <div className="section-heading">
                    <div>
                        <h3>上传素材</h3>
                        <p>支持一次添加多张图片，批量生成微信表情包规格。</p>
                    </div>
                    {images.length > 0 && (
                        <button type="button" className="btn-secondary btn-inline" onClick={clearAll}>
                            <Trash2 size={16} />
                            清空列表
                        </button>
                    )}
                </div>

                <label className="upload-card wechat-upload-card">
                    <input type="file" hidden accept="image/*" multiple onChange={handleAddImages} />
                    <ImagePlus size={44} color="#6366f1" style={{ marginBottom: '1rem' }} />
                    <h3>添加图片</h3>
                    <p className="subtitle">可多选上传，PNG / JPG / WEBP 都可以</p>
                </label>

                <div className="wechat-image-list">
                    {images.length === 0 ? (
                        <div className="empty-state">
                            <p>还没有素材，先添加几张图片吧。</p>
                        </div>
                    ) : (
                        images.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={`wechat-image-item ${selectedImageId === item.id ? 'active' : ''}`}
                                onClick={() => setSelectedImageId(item.id)}
                            >
                                <img src={item.previewUrl} alt={item.file.name} className="wechat-thumb" />
                                <div className="wechat-image-meta">
                                    <strong title={item.file.name}>{item.file.name}</strong>
                                    <span>{(item.file.size / 1024).toFixed(0)} KB</span>
                                </div>
                                <span
                                    className="remove-image-btn"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        removeImage(item.id);
                                    }}
                                >
                                    ×
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </section>

            <section className="wechat-panel action-panel">
                <div className="section-heading">
                    <div>
                        <h3>微信表情包制作</h3>
                        <p>输出 PNG，默认等比缩放并居中到目标画布，文件名自动追加后缀。</p>
                    </div>
                </div>

                <div className="selected-preview-card">
                    {selectedImage ? (
                        <>
                            <img src={selectedImage.previewUrl} alt={selectedImage.file.name} className="selected-preview-image" />
                            <div className="selected-preview-meta">
                                <strong>{selectedImage.file.name}</strong>
                                <span>当前用于横幅 / 封面 / 图标 生成</span>
                            </div>
                        </>
                    ) : (
                        <div className="empty-state compact">
                            <p>选择一张图片后，可生成横幅、封面和图标。</p>
                        </div>
                    )}
                </div>

                <div className="preset-grid">
                    <div className="preset-card">
                        <h4>批量表情包</h4>
                        <p>将全部已上传图片输出为 240 × 240</p>
                        <code>原始名称_240.png</code>
                        <button
                            type="button"
                            className="btn-primary full-width"
                            onClick={handleGenerateBatch}
                            disabled={isGenerating !== ''}
                        >
                            {isGenerating === 'batch240' ? '批量生成中...' : '一键生成 240 × 240'}
                        </button>
                    </div>

                    <div className="preset-card">
                        <h4>横幅</h4>
                        <p>基于当前选中图片生成 750 × 400</p>
                        <code>原始名称_横幅.png</code>
                        <button
                            type="button"
                            className="btn-secondary full-width"
                            onClick={() => handleGenerateSingle('banner')}
                            disabled={isGenerating !== ''}
                        >
                            {isGenerating === 'banner' ? '生成中...' : '生成横幅'}
                        </button>
                    </div>

                    <div className="preset-card">
                        <h4>封面</h4>
                        <p>基于当前选中图片生成 240 × 240</p>
                        <code>原始名称_封面.png</code>
                        <button
                            type="button"
                            className="btn-secondary full-width"
                            onClick={() => handleGenerateSingle('cover')}
                            disabled={isGenerating !== ''}
                        >
                            {isGenerating === 'cover' ? '生成中...' : '生成封面'}
                        </button>
                    </div>

                    <div className="preset-card">
                        <h4>图标</h4>
                        <p>基于当前选中图片生成 50 × 50</p>
                        <code>原始名称_图标.png</code>
                        <button
                            type="button"
                            className="btn-secondary full-width"
                            onClick={() => handleGenerateSingle('icon')}
                            disabled={isGenerating !== ''}
                        >
                            {isGenerating === 'icon' ? '生成中...' : '生成图标'}
                        </button>
                    </div>
                </div>

                {errorMessage && <div className="error-banner">{errorMessage}</div>}

                <div className="results-section">
                    <div className="section-heading">
                        <div>
                            <h3>导出结果</h3>
                            <p>生成后可逐个下载，也可以一次下载全部结果。</p>
                        </div>
                        {results.length > 0 && (
                            <button type="button" className="btn-primary btn-inline" onClick={downloadAllResults}>
                                <Download size={16} />
                                下载全部
                            </button>
                        )}
                    </div>

                    {results.length === 0 ? (
                        <div className="empty-state compact">
                            <p>还没有生成结果。</p>
                        </div>
                    ) : (
                        <div className="results-grid">
                            {results.map((result) => (
                                <div key={result.id} className="result-tile">
                                    <img src={result.url} alt={result.name} className="result-thumb" />
                                    <div className="result-meta">
                                        <strong title={result.name}>{result.name}</strong>
                                        <span>{result.presetLabel} · {result.sizeLabel}</span>
                                        <span>来源：{result.sourceName}</span>
                                    </div>
                                    <button type="button" className="btn-secondary full-width" onClick={() => downloadResult(result)}>
                                        <Download size={16} style={{ marginRight: '0.5rem' }} />
                                        下载
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>
        </main>
    );
}

export default WechatStickerMaker;
