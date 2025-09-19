/**
 * Logic Editor - Main JavaScript File
 */

class LogicNode {
    constructor(type, x, y, name) {
        this.id = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.type = type;
        this.x = x;
        this.y = y;
        this.name = name;
        this.selected = false;
        this.magnetizedChildren = [];
        this.element = null;
        this.createDOM();
    }
    
    createDOM() {
        const node = document.createElement('div');
        node.className = `logic-node ${this.type}`;
        node.id = this.id;
        node.style.left = this.x + 'px';
        node.style.top = this.y + 'px';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'node-name';
        nameSpan.contentEditable = false;
        nameSpan.textContent = this.name;
        
        const suffixSpan = document.createElement('span');
        suffixSpan.className = 'node-suffix';
        
        if (this.type === 'container') {
            suffixSpan.textContent = `{${this.magnetizedChildren.length}}`;
        } else if (this.type === 'onlyone' || this.type === 'equal') {
            suffixSpan.textContent = '()';
        }
        
        node.appendChild(nameSpan);
        node.appendChild(suffixSpan);
        
        if (this.type === 'container' || this.type === 'onlyone' || this.type === 'equal') {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'node-children';
            childrenDiv.style.display = 'none';
            node.appendChild(childrenDiv);
        }
        
        this.element = node;
    }
    
    updatePosition(x, y) {
        this.x = x;
        this.y = y;
        this.element.style.left = x + 'px';
        this.element.style.top = y + 'px';
    }
    
    setSelected(selected) {
        this.selected = selected;
        if (selected) {
            this.element.classList.add('selected');
        } else {
            this.element.classList.remove('selected');
        }
    }
    
    updateName(newName) {
        this.name = newName;
        this.element.querySelector('.node-name').textContent = newName;
    }
    
    addMagnetizedChild(childNode) {
        if (this.type === 'variable') return;
        
        // Check if already magnetized
        if (this.magnetizedChildren.some(child => child.id === childNode.id)) return;
        
        this.magnetizedChildren.push(childNode);
        const childrenDiv = this.element.querySelector('.node-children');
        
        if (childrenDiv) {
            childrenDiv.style.display = 'flex';
            
            const childElement = document.createElement('div');
            childElement.className = 'magnetized-child';
            childElement.textContent = childNode.name;
            childElement.dataset.childId = childNode.id;
            childrenDiv.appendChild(childElement);
            
            if (this.type === 'container') {
                const suffix = this.element.querySelector('.node-suffix');
                suffix.textContent = `{${this.magnetizedChildren.length}}`;
            }
        }
    }
}

class LogicEditor {
    constructor() {
        this.gridCanvas = document.getElementById('gridCanvas');
        this.gridViewport = document.getElementById('gridViewport');
        this.sideMenu = document.getElementById('sideMenu');
        this.selectionBox = document.getElementById('selectionBox');
        
        // Zoom settings
        this.zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2];
        this.currentZoomIndex = 2; // Start at 100%
        
        // Pan settings
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.scrollStartX = 0;
        this.scrollStartY = 0;
        
        // Nodes management
        this.nodes = new Map();
        this.selectedNodes = new Set();
        
        // Drag and selection
        this.isDraggingNode = false;
        this.isDraggingFromMenu = false;
        this.isSelecting = false;
        this.dragOffsets = new Map();
        this.selectionStart = { x: 0, y: 0 };
        
        // Editing
        this.editingNode = null;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.centerView();
    }
    
    setupEventListeners() {
        // Menu toggle
        document.getElementById('menuToggle').addEventListener('click', () => this.toggleMenu());
        
        // Zoom controls
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
        document.getElementById('resetViewBtn').addEventListener('click', () => this.resetView());
        
        // Mouse wheel zoom
        this.gridViewport.addEventListener('wheel', (e) => this.handleWheel(e));
        
        // Canvas mouse events
        this.gridCanvas.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        
        // Draggable menu items
        const draggableItems = document.querySelectorAll('.draggable-item');
        draggableItems.forEach(item => {
            item.addEventListener('mousedown', (e) => this.startMenuDrag(e, item));
        });
    }
    
    // Menu Functions
    toggleMenu() {
        this.sideMenu.classList.toggle('open');
    }
    
    startMenuDrag(e, item) {
        e.preventDefault();
        const nodeType = item.dataset.nodeType;
        
        // Create ghost element
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = item.querySelector('.item-preview').innerHTML;
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
        document.body.appendChild(ghost);
        
        this.isDraggingFromMenu = true;
        this.draggedNodeType = nodeType;
        this.dragGhost = ghost;
    }
    
    // Node Creation and Management
    createNode(type, x, y) {
        let name;
        switch(type) {
            case 'variable':
                name = 'Variable';
                break;
            case 'container':
                name = 'Container';
                break;
            case 'onlyone':
                name = 'OnlyOne';
                break;
            case 'equal':
                name = 'Equal';
                break;
            default:
                name = 'Node';
        }
        
        const node = new LogicNode(type, x, y, name);
        this.nodes.set(node.id, node);
        this.gridCanvas.appendChild(node.element);
        
        // Add node-specific event listeners
        node.element.addEventListener('mousedown', (e) => this.handleNodeMouseDown(e, node));
        
        const nameElement = node.element.querySelector('.node-name');
        nameElement.addEventListener('click', (e) => {
            if (!this.isDraggingNode && this.selectedNodes.has(node.id)) {
                e.stopPropagation();
                this.startEditingNodeName(node, nameElement);
            }
        });
        
        return node;
    }
    
    handleNodeMouseDown(e, node) {
        e.stopPropagation();
        
        if (e.button !== 0) return; // Only left click
        
        const shiftKey = e.shiftKey;
        const ctrlKey = e.ctrlKey || e.metaKey;
        
        if (!shiftKey && !ctrlKey && !this.selectedNodes.has(node.id)) {
            // Clear selection and select only this node
            this.clearSelection();
            this.selectNode(node);
        } else if (shiftKey) {
            // Add to selection
            this.selectNode(node);
        } else if (ctrlKey) {
            // Toggle selection
            if (this.selectedNodes.has(node.id)) {
                this.deselectNode(node);
            } else {
                this.selectNode(node);
            }
        }
        
        // Start dragging if node is selected
        if (this.selectedNodes.has(node.id)) {
            this.startNodeDrag(e);
        }
    }
    
    startNodeDrag(e) {
        this.isDraggingNode = true;
        
        // Calculate offsets for all selected nodes
        this.dragOffsets.clear();
        const zoom = this.zoomLevels[this.currentZoomIndex];
        
        this.selectedNodes.forEach(nodeId => {
            const node = this.nodes.get(nodeId);
            if (node) {
                const rect = this.gridViewport.getBoundingClientRect();
                const scrollLeft = this.gridViewport.scrollLeft;
                const scrollTop = this.gridViewport.scrollTop;
                
                const canvasX = (e.clientX - rect.left) / zoom + scrollLeft / zoom;
                const canvasY = (e.clientY - rect.top) / zoom + scrollTop / zoom;
                
                this.dragOffsets.set(nodeId, {
                    x: node.x - canvasX,
                    y: node.y - canvasY
                });
                
                node.element.classList.add('dragging');
            }
        });
    }
    
    // Selection Functions
    selectNode(node) {
        this.selectedNodes.add(node.id);
        node.setSelected(true);
    }
    
    deselectNode(node) {
        this.selectedNodes.delete(node.id);
        node.setSelected(false);
    }
    
    clearSelection() {
        this.selectedNodes.forEach(nodeId => {
            const node = this.nodes.get(nodeId);
            if (node) {
                node.setSelected(false);
            }
        });
        this.selectedNodes.clear();
    }
    
    startSelection(e) {
        this.isSelecting = true;
        const rect = this.gridViewport.getBoundingClientRect();
        const zoom = this.zoomLevels[this.currentZoomIndex];
        const scrollLeft = this.gridViewport.scrollLeft;
        const scrollTop = this.gridViewport.scrollTop;
        
        this.selectionStart = {
            x: (e.clientX - rect.left) / zoom + scrollLeft / zoom,
            y: (e.clientY - rect.top) / zoom + scrollTop / zoom
        };
        
        this.selectionBox.style.display = 'block';
        this.selectionBox.style.left = this.selectionStart.x + 'px';
        this.selectionBox.style.top = this.selectionStart.y + 'px';
        this.selectionBox.style.width = '0px';
        this.selectionBox.style.height = '0px';
    }
    
    updateSelection(e) {
        const rect = this.gridViewport.getBoundingClientRect();
        const zoom = this.zoomLevels[this.currentZoomIndex];
        const scrollLeft = this.gridViewport.scrollLeft;
        const scrollTop = this.gridViewport.scrollTop;
        
        const currentX = (e.clientX - rect.left) / zoom + scrollLeft / zoom;
        const currentY = (e.clientY - rect.top) / zoom + scrollTop / zoom;
        
        const left = Math.min(this.selectionStart.x, currentX);
        const top = Math.min(this.selectionStart.y, currentY);
        const width = Math.abs(currentX - this.selectionStart.x);
        const height = Math.abs(currentY - this.selectionStart.y);
        
        this.selectionBox.style.left = left + 'px';
        this.selectionBox.style.top = top + 'px';
        this.selectionBox.style.width = width + 'px';
        this.selectionBox.style.height = height + 'px';
        
        // Check which nodes are in selection box
        const shiftKey = e.shiftKey;
        const ctrlKey = e.ctrlKey || e.metaKey;
        
        this.nodes.forEach(node => {
            const nodeInBox = this.isNodeInSelectionBox(node, left, top, width, height);
            
            if (!shiftKey && !ctrlKey) {
                // Normal selection - replace
                if (nodeInBox) {
                    if (!this.selectedNodes.has(node.id)) {
                        this.selectNode(node);
                    }
                } else {
                    if (this.selectedNodes.has(node.id)) {
                        this.deselectNode(node);
                    }
                }
            } else if (shiftKey) {
                // Add to selection
                if (nodeInBox && !this.selectedNodes.has(node.id)) {
                    this.selectNode(node);
                }
            } else if (ctrlKey) {
                // Toggle selection
                if (nodeInBox) {
                    if (this.selectedNodes.has(node.id)) {
                        this.deselectNode(node);
                    } else {
                        this.selectNode(node);
                    }
                }
            }
        });
    }
    
    isNodeInSelectionBox(node, boxLeft, boxTop, boxWidth, boxHeight) {
        const nodeRight = node.x + node.element.offsetWidth;
        const nodeBottom = node.y + node.element.offsetHeight;
        const boxRight = boxLeft + boxWidth;
        const boxBottom = boxTop + boxHeight;
        
        return !(node.x > boxRight || nodeRight < boxLeft || 
                 node.y > boxBottom || nodeBottom < boxTop);
    }
    
    endSelection() {
        this.isSelecting = false;
        this.selectionBox.style.display = 'none';
    }
    
    // Name Editing
    startEditingNodeName(node, nameElement) {
        if (this.editingNode) {
            this.stopEditingNodeName();
        }
        
        this.editingNode = node;
        nameElement.contentEditable = true;
        nameElement.classList.add('editing');
        nameElement.focus();
        
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(nameElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Add event listeners for editing
        const stopEdit = () => {
            this.stopEditingNodeName();
        };
        
        nameElement.addEventListener('blur', stopEdit, { once: true });
        nameElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                stopEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                nameElement.textContent = node.name;
                stopEdit();
            }
        }, { once: true });
    }
    
    stopEditingNodeName() {
        if (!this.editingNode) return;
        
        const nameElement = this.editingNode.element.querySelector('.node-name');
        nameElement.contentEditable = false;
        nameElement.classList.remove('editing');
        
        const newName = nameElement.textContent.trim();
        if (newName) {
            this.editingNode.updateName(newName);
        } else {
            nameElement.textContent = this.editingNode.name;
        }
        
        this.editingNode = null;
    }
    
    // Canvas Mouse Events
    handleCanvasMouseDown(e) {
        if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
            // Pan
            e.preventDefault();
            this.startPan(e.clientX, e.clientY);
        } else if (e.button === 0 && !this.spacePressed) {
            // Selection
            const shiftKey = e.shiftKey;
            const ctrlKey = e.ctrlKey || e.metaKey;
            
            if (!shiftKey && !ctrlKey) {
                this.clearSelection();
            }
            
            this.startSelection(e);
        }
    }
    
    handleMouseMove(e) {
        if (this.isDraggingFromMenu && this.dragGhost) {
            this.dragGhost.style.left = e.clientX + 'px';
            this.dragGhost.style.top = e.clientY + 'px';
        } else if (this.isDraggingNode) {
            const rect = this.gridViewport.getBoundingClientRect();
            const zoom = this.zoomLevels[this.currentZoomIndex];
            const scrollLeft = this.gridViewport.scrollLeft;
            const scrollTop = this.gridViewport.scrollTop;
            
            const canvasX = (e.clientX - rect.left) / zoom + scrollLeft / zoom;
            const canvasY = (e.clientY - rect.top) / zoom + scrollTop / zoom;
            
            this.selectedNodes.forEach(nodeId => {
                const node = this.nodes.get(nodeId);
                const offset = this.dragOffsets.get(nodeId);
                if (node && offset) {
                    node.updatePosition(
                        canvasX + offset.x,
                        canvasY + offset.y
                    );
                }
            });
            
            // Check for potential magnetization targets while dragging
            this.checkPotentialMagnetizeTargets();
        } else if (this.isSelecting) {
            this.updateSelection(e);
        } else if (this.isPanning) {
            e.preventDefault();
            const deltaX = e.clientX - this.panStartX;
            const deltaY = e.clientY - this.panStartY;
            
            this.gridViewport.scrollLeft = this.scrollStartX - deltaX;
            this.gridViewport.scrollTop = this.scrollStartY - deltaY;
        }
    }
    
    handleMouseUp(e) {
        if (this.isDraggingFromMenu) {
            // Drop node from menu
            if (this.dragGhost) {
                const rect = this.gridViewport.getBoundingClientRect();
                const zoom = this.zoomLevels[this.currentZoomIndex];
                const scrollLeft = this.gridViewport.scrollLeft;
                const scrollTop = this.gridViewport.scrollTop;
                
                // Check if dropped on canvas
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    const x = (e.clientX - rect.left) / zoom + scrollLeft / zoom;
                    const y = (e.clientY - rect.top) / zoom + scrollTop / zoom;
                    const newNode = this.createNode(this.draggedNodeType, x - 60, y - 20);
                }
                
                document.body.removeChild(this.dragGhost);
                this.dragGhost = null;
            }
            this.isDraggingFromMenu = false;
            this.draggedNodeType = null;
        } else if (this.isDraggingNode) {
            // Check for magnetization when dropping
            this.checkMagnetization();
            
            this.selectedNodes.forEach(nodeId => {
                const node = this.nodes.get(nodeId);
                if (node) {
                    node.element.classList.remove('dragging');
                }
            });
            this.isDraggingNode = false;
            this.dragOffsets.clear();
            this.clearMagnetizeTargets();
        } else if (this.isSelecting) {
            this.endSelection();
        } else if (this.isPanning) {
            this.endPan();
        }
    }
    
    // Zoom Functions
    zoomIn() {
        if (this.currentZoomIndex < this.zoomLevels.length - 1) {
            this.currentZoomIndex++;
            this.applyZoom();
        }
    }
    
    zoomOut() {
        if (this.currentZoomIndex > 0) {
            this.currentZoomIndex--;
            this.applyZoom();
        }
    }
    
    applyZoom() {
        const zoom = this.zoomLevels[this.currentZoomIndex];
        
        // Get current center point before zoom
        const centerX = this.gridViewport.scrollLeft + this.gridViewport.clientWidth / 2;
        const centerY = this.gridViewport.scrollTop + this.gridViewport.clientHeight / 2;
        
        // Apply zoom
        this.gridCanvas.style.transform = `scale(${zoom})`;
        
        // Maintain center point after zoom
        setTimeout(() => {
            this.gridViewport.scrollLeft = centerX * zoom / this.zoomLevels[2] - this.gridViewport.clientWidth / 2;
            this.gridViewport.scrollTop = centerY * zoom / this.zoomLevels[2] - this.gridViewport.clientHeight / 2;
        }, 0);
    }
    
    handleWheel(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            
            if (e.deltaY < 0) {
                this.zoomIn();
            } else {
                this.zoomOut();
            }
        }
    }
    
    // View Functions
    resetView() {
        this.currentZoomIndex = 2; // 100%
        this.applyZoom();
        this.centerView();
    }
    
    centerView() {
        const canvasRect = this.gridCanvas.getBoundingClientRect();
        const viewportRect = this.gridViewport.getBoundingClientRect();
        
        this.gridViewport.scrollLeft = (canvasRect.width - viewportRect.width) / 2;
        this.gridViewport.scrollTop = (canvasRect.height - viewportRect.height) / 2;
    }
    
    // Pan Functions
    startPan(x, y) {
        this.isPanning = true;
        this.panStartX = x;
        this.panStartY = y;
        this.scrollStartX = this.gridViewport.scrollLeft;
        this.scrollStartY = this.gridViewport.scrollTop;
        this.gridViewport.style.cursor = 'grabbing';
    }
    
    endPan() {
        this.isPanning = false;
        this.gridViewport.style.cursor = this.spacePressed ? 'grab' : 'default';
    }
    
    // Keyboard Functions
    handleKeyDown(e) {
        // Space key for pan mode
        if (e.code === 'Space' && !this.spacePressed && !this.editingNode) {
            e.preventDefault();
            this.spacePressed = true;
            if (!this.isPanning) {
                this.gridViewport.style.cursor = 'grab';
            }
        }
        
        // Delete key
        if (e.key === 'Delete' && !this.editingNode) {
            this.deleteSelectedNodes();
        }
        
        // Zoom shortcuts
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                this.zoomIn();
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this.zoomOut();
            } else if (e.key === '0') {
                e.preventDefault();
                this.resetView();
            }
        }
    }
    
    handleKeyUp(e) {
        if (e.code === 'Space') {
            this.spacePressed = false;
            if (!this.isPanning) {
                this.gridViewport.style.cursor = 'default';
            }
        }
    }
    
    deleteSelectedNodes() {
        this.selectedNodes.forEach(nodeId => {
            const node = this.nodes.get(nodeId);
            if (node) {
                // Remove from parent if magnetized
                this.nodes.forEach(otherNode => {
                    if (otherNode.magnetizedChildren.includes(node)) {
                        this.removeMagnetizedChild(otherNode, node);
                    }
                });
                
                node.element.remove();
                this.nodes.delete(nodeId);
            }
        });
        this.selectedNodes.clear();
    }
    
    // Magnetization Functions
    checkPotentialMagnetizeTargets() {
        // Clear previous highlights
        this.clearMagnetizeTargets();
        
        // Only check if dragging a single variable node
        if (this.selectedNodes.size !== 1) return;
        
        const draggedNodeId = Array.from(this.selectedNodes)[0];
        const draggedNode = this.nodes.get(draggedNodeId);
        
        if (!draggedNode || draggedNode.type !== 'variable') return;
        
        // Check all container and function nodes
        this.nodes.forEach(node => {
            if (node.id === draggedNodeId) return;
            if (node.type === 'variable') return;
            
            // Check if dragged node is near the bottom of this node
            const distance = this.getDistanceToNodeBottom(draggedNode, node);
            if (distance < 50) {
                node.element.classList.add('magnetize-target');
            }
        });
    }
    
    clearMagnetizeTargets() {
        this.nodes.forEach(node => {
            node.element.classList.remove('magnetize-target');
        });
    }
    
    getDistanceToNodeBottom(draggedNode, targetNode) {
        const draggedRect = draggedNode.element.getBoundingClientRect();
        const targetRect = targetNode.element.getBoundingClientRect();
        
        const draggedCenterX = draggedNode.x + draggedRect.width / 2;
        const draggedTop = draggedNode.y;
        
        const targetCenterX = targetNode.x + targetRect.width / 2;
        const targetBottom = targetNode.y + targetNode.element.offsetHeight;
        
        const dx = draggedCenterX - targetCenterX;
        const dy = draggedTop - targetBottom;
        
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    checkMagnetization() {
        // Only magnetize if dragging a single variable node
        if (this.selectedNodes.size !== 1) return;
        
        const draggedNodeId = Array.from(this.selectedNodes)[0];
        const draggedNode = this.nodes.get(draggedNodeId);
        
        if (!draggedNode || draggedNode.type !== 'variable') return;
        
        let closestNode = null;
        let closestDistance = 50; // Maximum magnetize distance
        
        this.nodes.forEach(node => {
            if (node.id === draggedNodeId) return;
            if (node.type === 'variable') return;
            
            const distance = this.getDistanceToNodeBottom(draggedNode, node);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestNode = node;
            }
        });
        
        if (closestNode) {
            this.magnetizeNodeTo(draggedNode, closestNode);
        }
    }
    
    magnetizeNodeTo(childNode, parentNode) {
        // Remove from any previous parent
        this.nodes.forEach(node => {
            if (node.magnetizedChildren.includes(childNode)) {
                this.removeMagnetizedChild(node, childNode);
            }
        });
        
        // Add to new parent
        parentNode.addMagnetizedChild(childNode);
        
        // Position child below parent
        const parentRect = parentNode.element.getBoundingClientRect();
        const parentBottom = parentNode.y + parentNode.element.offsetHeight;
        
        childNode.updatePosition(parentNode.x, parentBottom + 10);
        
        // Hide the original child node from canvas
        childNode.element.style.display = 'none';
        
        // Add click handler to detach
        const childrenDiv = parentNode.element.querySelector('.node-children');
        const childElement = childrenDiv.querySelector(`[data-child-id="${childNode.id}"]`);
        if (childElement) {
            childElement.style.cursor = 'pointer';
            childElement.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.detachMagnetizedChild(parentNode, childNode);
            });
        }
    }
    
    detachMagnetizedChild(parentNode, childNode) {
        this.removeMagnetizedChild(parentNode, childNode);
        
        // Position the detached node near its former parent
        const parentRect = parentNode.element.getBoundingClientRect();
        childNode.updatePosition(
            parentNode.x + parentRect.width + 20,
            parentNode.y
        );
        
        // Select the detached node
        this.clearSelection();
        this.selectNode(childNode);
    }
    
    removeMagnetizedChild(parentNode, childNode) {
        const index = parentNode.magnetizedChildren.indexOf(childNode);
        if (index > -1) {
            parentNode.magnetizedChildren.splice(index, 1);
            
            // Update UI
            const childrenDiv = parentNode.element.querySelector('.node-children');
            if (childrenDiv) {
                const childElement = childrenDiv.querySelector(`[data-child-id="${childNode.id}"]`);
                if (childElement) {
                    childElement.remove();
                }
                
                if (parentNode.magnetizedChildren.length === 0) {
                    childrenDiv.style.display = 'none';
                }
                
                if (parentNode.type === 'container') {
                    const suffix = parentNode.element.querySelector('.node-suffix');
                    suffix.textContent = `{${parentNode.magnetizedChildren.length}}`;
                }
            }
            
            // Show the child node again
            childNode.element.style.display = 'block';
        }
    }
}

// Initialize the editor when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.logicEditor = new LogicEditor();
});