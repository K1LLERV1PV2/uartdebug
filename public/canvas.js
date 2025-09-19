// canvas.js
export class Canvas {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.canvas.width = this.canvas.clientWidth;
    this.canvas.height = this.canvas.clientHeight;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Новая версия метода drawGrid принимает текущий масштаб (zoom)
  // и смещение (offset) для того, чтобы вычислить границы видимой области.
  drawGrid(zoom = 1, offset = { x: 0, y: 0 }) {
    const ctx = this.ctx;
    ctx.save();

    // Инвертированный масштаб для вычисления мировых координат
    const invScale = 1 / zoom;

    // Вычисляем видимые границы в мировых координатах
    const visibleLeft = -offset.x * invScale;
    const visibleTop = -offset.y * invScale;
    const visibleRight = (this.canvas.width - offset.x) * invScale;
    const visibleBottom = (this.canvas.height - offset.y) * invScale;

    // Основная сетка с шагом 20
    const mainStep = 20;
    ctx.strokeStyle = "rgba(85,85,85,0.5)";

    // Определяем стартовую вертикальную линию
    let startX = Math.floor(visibleLeft / mainStep) * mainStep;
    for (let x = startX; x <= visibleRight; x += mainStep) {
      ctx.beginPath();
      ctx.moveTo(x, visibleTop);
      ctx.lineTo(x, visibleBottom);
      ctx.stroke();
    }

    // Определяем стартовую горизонтальную линию
    let startY = Math.floor(visibleTop / mainStep) * mainStep;
    for (let y = startY; y <= visibleBottom; y += mainStep) {
      ctx.beginPath();
      ctx.moveTo(visibleLeft, y);
      ctx.lineTo(visibleRight, y);
      ctx.stroke();
    }

    // При отдалении (zoom < 1) добавляем дополнительную детальную сетку с шагом 5
    if (zoom < 1) {
      const detailStep = 5;
      ctx.strokeStyle = "rgba(85,85,85,0.2)";
      let startXDetail = Math.floor(visibleLeft / detailStep) * detailStep;
      for (let x = startXDetail; x <= visibleRight; x += detailStep) {
        ctx.beginPath();
        ctx.moveTo(x, visibleTop);
        ctx.lineTo(x, visibleBottom);
        ctx.stroke();
      }
      let startYDetail = Math.floor(visibleTop / detailStep) * detailStep;
      for (let y = startYDetail; y <= visibleBottom; y += detailStep) {
        ctx.beginPath();
        ctx.moveTo(visibleLeft, y);
        ctx.lineTo(visibleRight, y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  getContext() {
    return this.ctx;
  }
}
