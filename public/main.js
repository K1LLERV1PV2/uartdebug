// main.js
import { UI } from "./ui.js"; 

function initApp() {
  if (window.uiInstance) return; // Если уже создан – ничего не делаем
  const canvasElement = document.getElementById("canvas");
  const sidePanel = document.getElementById("side-panel");
  const contextMenu = document.getElementById("context-menu");
  const nodeList = document.getElementById("node-list");
  const nodeNameInput = document.getElementById("node-name");
  const saveBtn = document.getElementById("save-btn");
  const loadBtn = document.getElementById("load-btn");

  window.uiInstance = new UI(
    canvasElement,
    sidePanel,
    contextMenu,
    nodeList,
    nodeNameInput,
    saveBtn,
    loadBtn
  );
}

window.addEventListener("load", initApp);

const params = new URLSearchParams(window.location.search);
if (params.get('confirmed') === '1') {
  // Показываем уведомление (например, баннер)
  alert('E-mail успешно подтверждён. Теперь вы можете войти.');
  // Убираем параметр из адресной строки
  history.replaceState(null, '', window.location.pathname);
}

function showNotification(message, duration = 3000) {
  const container = document.getElementById("notification-container");
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.innerText = message;
  container.appendChild(notification);

  // Через небольшой timeout добавляем класс show для эффекта fade-in
  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  // После истечения времени убираем уведомление и удаляем элемент
  setTimeout(() => {
    notification.classList.remove("show");
    // После завершения анимации fade-out удаляем из DOM
    setTimeout(() => {
      container.removeChild(notification);
    }, 500);
  }, duration);
}

// Опционально: можно переопределить window.alert, чтобы использовать кастомные уведомления
window.alert = function (message) {
  showNotification(message);
};
