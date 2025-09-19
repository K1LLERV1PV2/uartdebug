// graph.js
import { Node } from "./node.js";
import { Edge } from "./edge.js";

export class Graph {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.objects = [];
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this.nextObjectId = 1;
  }

  addNode(x, y) {
    // Нельзя создать узел на существующем узле
    for (let node of this.nodes) {
      if (node.isPointInside(x, y)) {
        return null;
      }
    }
    const node = new Node(this.nextNodeId++, x, y);
    // Устанавливаем имя узла равным его индексу
    node.name = node.id.toString();
    this.nodes.push(node);
    return node;
  }

  removeNode(node) {
    // Удаляем связи, связанные с узлом
    this.edges = this.edges.filter(
      (edge) => edge.fromNode !== node && edge.toNode !== node
    );
    // Удаляем сам узел
    this.nodes = this.nodes.filter((n) => n !== node);
  }

  addObject(x, y, type) {
    const obj = {
      id: this.nextObjectId++,
      x,
      y,
      type,
      scaleX: 1,
      scaleY: 1,
      selected: false,
      color: "#888888", // добавили поле цвета
    };
    this.objects.push(obj);
    return obj;
  }

  // Удалить объект
  removeObject(obj) {
    this.objects = this.objects.filter((o) => o !== obj);
  }

  // -----------------------------
  // Поиск объекта под курсором с учётом scaleX/scaleY
  // -----------------------------
  getObjectAt(x, y) {
    return this.objects.find((o) => {
      const dx = Math.abs(o.x - x);
      const dy = Math.abs(o.y - y);

      // Полуширины фигуры в мировых координатах
      const rx = 20 * o.scaleX;
      const ry = 20 * o.scaleY;

      if (o.type === "circle") {
        // Эллипс: (dx/rx)^2 + (dy/ry)^2 <= 1
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
      } else {
        // Квадрат и треугольник — упрощённо через ограничивающий прямоугольник
        return dx <= rx && dy <= ry;
      }
    });
  }

  // Сброс выделения у всех объектов
  clearObjectSelection() {
    this.objects.forEach((o) => (o.selected = false));
  }

  getSelectedObjects() {
    return this.objects.filter((o) => o.selected);
  }

  addEdge(fromNode, toNode) {
    const edge = new Edge(this.nextEdgeId++, fromNode, toNode);
    this.edges.push(edge);
    return edge;
  }

  addTempEdge(fromNode, x, y) {
    const edge = new Edge(this.nextEdgeId++, fromNode, null);
    edge.setTempEnd(x, y);
    this.edges.push(edge);
    return edge;
  }

  removeEdge(edge) {
    this.edges = this.edges.filter((e) => e !== edge);
  }

  getNodeAt(x, y) {
    return this.nodes.find((node) => node.isPointInside(x, y));
  }

  getEdgeAt(x, y) {
    return this.edges.find((edge) => edge.isPointNear(x, y));
  }

  clearSelection() {
    for (let node of this.nodes) {
      node.selected = false;
    }
    for (let edge of this.edges) {
      edge.selected = false;
    }
  }

  getSelectedNodes() {
    return this.nodes.filter((n) => n.selected);
  }

  getSelectedEdges() {
    return this.edges.filter((e) => e.selected);
  }

  // Удаляет из графа все выбранные узлы, связи и объекты
  deleteSelected() {
    // Сначала удаляем выделенные объекты
    this.getSelectedObjects().forEach((o) => this.removeObject(o));

    // Затем связи
    this.getSelectedEdges().forEach((e) => this.removeEdge(e));

    // И наконец узлы (removeNode также удалит связанные с ними связи)
    this.getSelectedNodes().forEach((n) => this.removeNode(n));
  }
}
