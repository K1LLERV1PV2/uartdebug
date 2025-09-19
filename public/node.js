// node.js
export class Node {
  constructor(id, x, y, name = "Новый узел") {
    this.id = id;
    this.x = x;
    this.y = y;
    this.radius = 20;

    this.name = name;
    this.base = ""; // новое поле
    this.rel = ""; // новое поле
    this.selected = false;
    // shapeType может быть одним из:
    // circle-solid, circle-dashed,
    // rect-solid, rect-rounded-solid,
    // rect-dashed, rect-rounded-dashed
    this.shapeType = "circle-solid";
  }

  computeBounds(ctx) {
    if (this.shapeType.startsWith("circle")) {
      this._boundWidth = this.radius * 2;
      this._boundHeight = this.radius * 2;
    } else {
      ctx.font = "12px Arial";
      const lineHeight = 16;
      const padding = 8;
      const texts = [this.name, "Base: " + this.base, "Rel: " + this.rel];
      // Measure max text width
      let maxW = 0;
      for (let t of texts) {
        maxW = Math.max(maxW, ctx.measureText(t).width);
      }
      this._boundWidth = Math.max(maxW + padding * 2, this.radius * 4);
      this._boundHeight = texts.length * lineHeight + padding * 2;
    }
  }

  draw(ctx) {
    ctx.save();

    const dashed = this.shapeType.endsWith("-dashed");
    const isCircle = this.shapeType.startsWith("circle");
    const isRounded = this.shapeType.includes("rounded");

    ctx.lineWidth = 2;
    ctx.setLineDash(dashed ? [5, 5] : []);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = this.selected ? "#16a085" : "#888";

    if (isCircle) {
      // сохраняем габариты круга
      this._boundWidth = this.radius * 2;
      this._boundHeight = this.radius * 2;

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // подпись
      ctx.fillStyle = "#000";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.name, this.x, this.y);
    } else {
      // вычисляем размеры рамки по трём строкам
      ctx.font = "12px Arial";
      const lineHeight = 16;
      const padding = 8;
      const texts = [this.name, "Base: " + this.base, "Rel: " + this.rel];

      // максимально широкая строка
      let maxW = texts.reduce((m, t) => {
        const w = ctx.measureText(t).width;
        return w > m ? w : m;
      }, 0);

      const rectW = Math.max(maxW + padding * 2, this.radius * 4);
      const rectH = texts.length * lineHeight + padding * 2;
      const x0 = this.x - rectW / 2;
      const y0 = this.y - rectH / 2;

      // сохраняем габариты рамки
      this._boundWidth = rectW;
      this._boundHeight = rectH;

      // рисуем path рамки
      ctx.beginPath();
      if (isRounded) {
        const r = 6;
        ctx.moveTo(x0 + r, y0);
        ctx.lineTo(x0 + rectW - r, y0);
        ctx.quadraticCurveTo(x0 + rectW, y0, x0 + rectW, y0 + r);
        ctx.lineTo(x0 + rectW, y0 + rectH - r);
        ctx.quadraticCurveTo(
          x0 + rectW,
          y0 + rectH,
          x0 + rectW - r,
          y0 + rectH
        );
        ctx.lineTo(x0 + r, y0 + rectH);
        ctx.quadraticCurveTo(x0, y0 + rectH, x0, y0 + rectH - r);
        ctx.lineTo(x0, y0 + r);
        ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
      } else {
        ctx.rect(x0, y0, rectW, rectH);
      }
      ctx.fill();
      ctx.stroke();

      // вывод трёх строк: имя по-центру, Base/Rel слева
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        const y = y0 + padding + i * lineHeight;
        ctx.fillStyle = "#000";
        if (i === 0) {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(t, this.x, y);
        } else {
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(t, x0 + padding, y);
        }
      }
    }

    ctx.restore();
  }

  isPointInside(px, py) {
    if (this.shapeType.startsWith("circle")) {
      const dx = this.x - px,
        dy = this.y - py;
      return dx * dx + dy * dy <= this.radius * this.radius;
    } else {
      // теперь используем реальные габариты рамки
      const halfW = this._boundWidth / 2;
      const halfH = this._boundHeight / 2;
      return (
        px >= this.x - halfW &&
        px <= this.x + halfW &&
        py >= this.y - halfH &&
        py <= this.y + halfH
      );
    }
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
  }
}
