export function drawObject(ctx, o, uiScale) {
  // 1) Заливка заданным цветом (учитываем o.color)
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.scaleX, o.scaleY);
  ctx.fillStyle = o.color; // вместо жесткого «#888» или выделения
  switch (o.type) {
    case "circle":
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "square":
      ctx.beginPath();
      ctx.rect(-20, -20, 40, 40);
      ctx.fill();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(20, 20);
      ctx.lineTo(-20, 20);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();

  // 2) Обводка (не масштабируется)
  ctx.save();
  ctx.beginPath();
  if (o.type === "circle") {
    ctx.ellipse(o.x, o.y, 20 * o.scaleX, 20 * o.scaleY, 0, 0, Math.PI * 2);
  } else if (o.type === "square") {
    ctx.rect(
      o.x - 20 * o.scaleX,
      o.y - 20 * o.scaleY,
      40 * o.scaleX,
      40 * o.scaleY
    );
  } else if (o.type === "triangle") {
    const p1x = o.x,
      p1y = o.y - 20 * o.scaleY;
    const p2x = o.x + 20 * o.scaleX,
      p2y = o.y + 20 * o.scaleY;
    const p3x = o.x - 20 * o.scaleX,
      p3y = o.y + 20 * o.scaleY;
    ctx.moveTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.lineTo(p3x, p3y);
    ctx.closePath();
  }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2 / uiScale;
  ctx.stroke();
  ctx.restore();
}
