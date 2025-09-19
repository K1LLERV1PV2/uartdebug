// auth-ui.js
// Модуль для инициализации логики входа и регистрации на отдельных страницах
export function initAuthUI() {
  // Элементы форм
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  
  // Кнопка закрытия и фон модалки
  const authClose = document.getElementById('auth-close');
  const loginScreen = document.getElementById('login-screen');

  // Логика формы входа
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password })
        });
        if (res.ok) {
          // Успешный вход — перенаправление в редактор
          window.location.href = '/';
        } else {
          const body = await res.json().catch(() => ({}));
          alert(body.error || 'Неверные учётные данные');
        }
      } catch (err) {
        console.error('Login error:', err);
        alert('Ошибка подключения к серверу');
      }
    });
  }

  // Логика формы регистрации
  if (registerForm) {
    registerForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password })
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 201) {
          alert(body.message || 'Проверьте вашу почту для подтверждения.');
        } else {
          alert(body.error || 'Ошибка регистрации.');
        }
      } catch (err) {
        console.error('Register error:', err);
        alert('Ошибка подключения к серверу');
      }
    });
  }

  // Закрытие модалки крестиком
  if (authClose) {
    authClose.addEventListener('click', e => {
      e.preventDefault();
      window.history.back();
    });
  }

  // Закрытие кликом по фону модалки
  if (loginScreen) {
    loginScreen.addEventListener('click', e => {
      if (e.target === loginScreen) {
        window.history.back();
      }
    });
  }
}

// Инициализация при загрузке DOM

document.addEventListener('DOMContentLoaded', initAuthUI);
