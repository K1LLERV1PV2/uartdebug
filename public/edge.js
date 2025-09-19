// edge.js
export class Edge {
  constructor(id, fromNode, toNode = null) {
    this.id = id;
    this.fromNode = fromNode;
    this.toNode = toNode; // Если null – временная связь
    this.tempEnd = { x: 0, y: 0 }; // Точка конца при тянущейся связи
    this.selected = false;
  }

  draw(ctx) {
    const fx = this.fromNode.x,
      fy = this.fromNode.y;
    const tx = this.toNode ? this.toNode.x : this.tempEnd.x;
    const ty = this.toNode ? this.toNode.y : this.tempEnd.y;

    let dx = tx - fx,
      dy = ty - fy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return;
    dx /= dist;
    dy /= dist;

    // вычисляем смещение для узла (circle or rect)
    const getOffset = (node) => {
      if (node.shapeType.startsWith("circle")) {
        return node.radius;
      } else {
        const halfW = node._boundWidth / 2;
        const halfH = node._boundHeight / 2;
        const tX = Math.abs(halfW / dx);
        const tY = Math.abs(halfH / dy);
        return Math.min(tX, tY);
      }
    };

    const startOffset = getOffset(this.fromNode);
    const startX = fx + dx * startOffset;
    const startY = fy + dy * startOffset;

    let endX, endY;
    if (this.toNode) {
      const endOffset = getOffset(this.toNode);
      endX = tx - dx * endOffset;
      endY = ty - dy * endOffset;
    } else {
      endX = this.tempEnd.x;
      endY = this.tempEnd.y;
    }

    ctx.save();
    ctx.strokeStyle = this.selected ? "#16a085" : "#fff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    if (this.toNode) {
      // стрелка на конце
      const arrowLen = 10;
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - arrowLen * Math.cos(angle - Math.PI / 6),
        endY - arrowLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - arrowLen * Math.cos(angle + Math.PI / 6),
        endY - arrowLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = this.selected ? "#16a085" : "#fff";
      ctx.fill();
    }

    ctx.restore();
  }

  setTempEnd(x, y) {
    this.tempEnd.x = x;
    this.tempEnd.y = y;
  }

  // Проверка попадания курсора рядом со связью для выделения
  isPointNear(px, py) {
    const fx = this.fromNode.x;
    const fy = this.fromNode.y;
    const tx = this.toNode ? this.toNode.x : this.tempEnd.x;
    const ty = this.toNode ? this.toNode.y : this.tempEnd.y;
    const dist = pointLineDistance(px, py, fx, fy, tx, ty);
    return dist < 5;
  }
}

function pointLineDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;

  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}
