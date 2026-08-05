const daysOfWeek = [
  { id: 1, short: 'Seg', name: 'Segunda-feira' },
  { id: 2, short: 'Ter', name: 'Terça-feira' },
  { id: 3, short: 'Qua', name: 'Quarta-feira' },
  { id: 4, short: 'Qui', name: 'Quinta-feira' },
  { id: 5, short: 'Sex', name: 'Sexta-feira' },
  { id: 6, short: 'Sáb', name: 'Sábado' }
];

const $ = s => document.querySelector(s);
const now = new Date();
let user = null;
let profile = null;
let subjects = [];
let signup = false;

const hours = n => `${n} ${n === 1 ? 'hora' : 'horas'}`;

function totals(s) {
  const total = +s.total_hours;
  return {
    total,
    allowed: Math.floor(total * (+s.absence_limit / 100)),
    absent: +s.absence_count
  };
}

function message(text, ok = false) {
  $('#authMessage').textContent = text;
  $('#authMessage').classList.toggle('success', ok);
}

function authView() {
  $('#authTitle').textContent = signup ? 'Crie sua conta' : 'Acesse seu painel';
  $('#authSubtitle').textContent = signup
    ? 'Cadastre-se para acompanhar suas matérias e faltas.'
    : 'Entre com seu e-mail e senha para acessar suas matérias.';

  const signupFields = $('#signupOnlyFields');
  const nameInput = $('#userName');
  if (signupFields) signupFields.hidden = !signup;
  if (nameInput) nameInput.required = signup;

  $('#tabLogin')?.classList.toggle('active', !signup);
  $('#tabSignup')?.classList.toggle('active', signup);
  $('#authSubmit').textContent = signup ? 'Criar conta' : 'Entrar';
}

function calcHours(startStr, endStr) {
  if (!startStr || !endStr) return 2;
  const [sH, sM] = startStr.split(':').map(Number);
  const [eH, eM] = endStr.split(':').map(Number);
  let diff = (eH * 60 + eM) - (sH * 60 + sM);
  if (diff <= 0) diff += 24 * 60;
  return Math.max(0.5, Math.round((diff / 60) * 10) / 10);
}

function formatAulasBadge(h) {
  const aulas = Math.round(h / 2);
  if (h % 2 === 0 && aulas > 0) {
    return `${h}h (${aulas} ${aulas === 1 ? 'aula' : 'aulas'})`;
  }
  return `${h}h`;
}

function renderSlotRow(dayId, slotIndex, startVal, endVal) {
  const h = calcHours(startVal, endVal);
  return `<div class="slot-row" data-day="${dayId}" data-index="${slotIndex}">
    <span>Horário:</span>
    <input type="time" class="slot-start" value="${startVal}">
    <span>até</span>
    <input type="time" class="slot-end" value="${endVal}">
    <span class="slot-badge">${formatAulasBadge(h)}</span>
    <button type="button" class="remove-slot-btn" title="Remover este horário">✕</button>
  </div>`;
}

function updateDayTotal(dayId) {
  const container = $(`#slotsFor-${dayId}`);
  if (!container) return;
  const rows = container.querySelectorAll('.slot-row');
  let totalH = 0;
  rows.forEach(r => {
    const s = r.querySelector('.slot-start').value;
    const e = r.querySelector('.slot-end').value;
    const h = calcHours(s, e);
    r.querySelector('.slot-badge').textContent = formatAulasBadge(h);
    totalH += h;
  });
  const totalBadge = $(`#dayTotal-${dayId}`);
  if (totalBadge) totalBadge.textContent = totalH > 0 ? `Total: ${formatAulasBadge(totalH)}` : '';
}

function dayPicker(s) {
  $('#daysPicker').innerHTML = daysOfWeek.map(d => {
    const saved = s?.days?.find(x => +x.day === d.id);
    const checked = Boolean(saved);

    let slots = [];
    if (saved) {
      if (saved.slots && Array.isArray(saved.slots) && saved.slots.length) {
        slots = saved.slots;
      } else {
        slots = [{ start: saved.start || '18:30', end: saved.end || (saved.hours === 4 ? '22:40' : '20:30'), hours: saved.hours || 2 }];
      }
    } else {
      slots = [{ start: '18:30', end: '20:30', hours: 2 }];
    }

    const dayTotalH = checked ? slots.reduce((acc, x) => acc + (x.hours || calcHours(x.start, x.end)), 0) : 0;
    const slotsHTML = slots.map((sl, idx) => renderSlotRow(d.id, idx, sl.start, sl.end)).join('');

    return `<div class="day-picker-item">
      <div class="day-header">
        <label class="day-checkbox-label">
          <input type="checkbox" data-day="${d.id}" ${checked ? 'checked' : ''}>
          <strong>${d.name}</strong>
        </label>
        <span class="day-total-badge" id="dayTotal-${d.id}">${checked ? `Total: ${formatAulasBadge(dayTotalH)}` : ''}</span>
      </div>
      <div class="slots-container" id="slotsFor-${d.id}" ${checked ? '' : 'hidden'}>
        <div class="slots-list" id="slotsList-${d.id}">${slotsHTML}</div>
        <button type="button" class="add-slot-btn" data-add-slot="${d.id}">+ Adicionar outro horário neste dia</button>
      </div>
    </div>`;
  }).join('');

  $('#daysPicker').onclick = e => {
    const addBtn = e.target.closest('.add-slot-btn');
    if (addBtn) {
      const dayId = +addBtn.dataset.addSlot;
      const list = $(`#slotsList-${dayId}`);
      if (list) {
        const count = list.children.length;
        const newRow = document.createElement('div');
        newRow.innerHTML = renderSlotRow(dayId, count, '17:00', '19:00');
        list.append(newRow.firstElementChild);
        updateDayTotal(dayId);
      }
      return;
    }

    const remBtn = e.target.closest('.remove-slot-btn');
    if (remBtn) {
      const row = remBtn.closest('.slot-row');
      const dayId = +row.dataset.day;
      const list = $(`#slotsList-${dayId}`);
      if (list.children.length > 1) {
        row.remove();
        updateDayTotal(dayId);
      } else {
        alert('Cada dia marcado precisa ter pelo menos um horário.');
      }
      return;
    }
  };

  $('#daysPicker').onchange = e => {
    const chk = e.target.closest('input[type=checkbox]');
    if (chk) {
      const dayId = +chk.dataset.day;
      const container = $(`#slotsFor-${dayId}`);
      if (container) container.hidden = !chk.checked;
      updateDayTotal(dayId);
      return;
    }

    const timeInput = e.target.closest('input[type=time]');
    if (timeInput) {
      const row = timeInput.closest('.slot-row');
      if (row) {
        updateDayTotal(+row.dataset.day);
      }
    }
  };
}

function subjectModal(s) {
  const f = $('#subjectForm');
  f.dataset.id = s?.id || '';
  $('#subjectName').value = s?.name || '';
  $('#subjectColor').value = s?.color || '#6d5dfc';
  $('#subjectLimit').value = s?.absence_limit || 25;
  $('#subjectTotalHours').value = s?.total_hours || '';
  $('#modalEyebrow').textContent = s ? 'EDITAR MATÉRIA' : 'NOVA MATÉRIA';
  $('#modalTitle').textContent = s ? 'Editar disciplina' : 'Adicionar disciplina';
  $('#subjectSubmitButton').textContent = s ? 'Salvar alterações' : 'Adicionar matéria';
  const delBtn = $('#deleteSubjectInModal');
  delBtn.hidden = !s;
  delBtn.onclick = async () => {
    $('#subjectModal').close();
    await remove(s);
  };
  dayPicker(s);
  $('#subjectModal').showModal();
}

function renderCalendar() {
  const calendar = $('#weekCalendar');
  if (!calendar) return;
  calendar.innerHTML = '';

  // 1. Coleta todas as aulas de todos os dias
  const allScheduledItems = [];
  subjects.forEach(subject => {
    (subject.days || []).forEach(item => {
      const dayId = +item.day;
      const slots = item.slots && item.slots.length
        ? item.slots
        : (item.start ? [{ start: item.start, end: item.end }] : []);

      slots.forEach(slot => {
        allScheduledItems.push({
          dayId,
          subject,
          start: slot.start || '18:30',
          end: slot.end || '20:30'
        });
      });
    });
  });

  // 2. Mapeia e ordena todos os horários únicos (slots) da semana
  const uniqueSlotsMap = new Map();
  allScheduledItems.forEach(item => {
    const key = `${item.start}-${item.end}`;
    if (!uniqueSlotsMap.has(key)) {
      uniqueSlotsMap.set(key, { start: item.start, end: item.end, key });
    }
  });

  const sortedTimeSlots = Array.from(uniqueSlotsMap.values()).sort((a, b) => {
    const startCmp = a.start.localeCompare(b.start);
    if (startCmp !== 0) return startCmp;
    return a.end.localeCompare(b.end);
  });

  // 3. Renderiza cada dia alinhando os horários em linhas correspondentes
  daysOfWeek.forEach(day => {
    const column = document.createElement('article');
    column.className = 'calendar-day';
    const title = document.createElement('h3');
    title.textContent = day.name;
    column.append(title);

    const dayItems = allScheduledItems.filter(x => x.dayId === day.id);

    if (!dayItems.length) {
      const empty = document.createElement('p');
      empty.className = 'calendar-empty';
      empty.textContent = 'Sem aulas';
      column.append(empty);
    } else {
      sortedTimeSlots.forEach(slot => {
        const matchingItem = dayItems.find(item => item.start === slot.start && item.end === slot.end);
        if (matchingItem) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'calendar-item';
          item.style.borderLeftColor = matchingItem.subject.color;
          item.textContent = `${matchingItem.subject.name} (${matchingItem.start} - ${matchingItem.end})`;
          item.onclick = () => document.getElementById(`subject-${matchingItem.subject.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          column.append(item);
        } else {
          // Espaço reservado para alinhar com outras matérias do mesmo horário em outros dias
          const placeholder = document.createElement('div');
          placeholder.className = 'calendar-item-placeholder';
          column.append(placeholder);
        }
      });
    }

    calendar.append(column);
  });
}

function render() {
  const shell = $('.app-shell');
  if (!user || !profile) {
    if (shell) shell.hidden = true;
    document.body.classList.add('logged-out');
    authView();
    if (!$('#userModal').open) $('#userModal').showModal();
    return;
  }
  document.body.classList.remove('logged-out');
  if (shell) shell.hidden = false;
  $('#userModal').close();
  $('#greetingName').textContent = profile.name;
  $('#profileCard').innerHTML = `<span class="avatar">${(profile.name[0] || 'U').toUpperCase()}</span><div><strong>${profile.name}</strong><small>${user.email}</small></div>`;

  const all = subjects.map(totals);
  const absent = all.reduce((n, x) => n + x.absent, 0);

  // Calcula se a matéria atingiu 15% de faltas em relação à carga horária total
  const risk = subjects.filter(s => {
    const t = totals(s);
    return t.total > 0 && (t.absent / t.total) * 100 >= 15;
  }).length;

  $('#statsGrid').innerHTML = [
    ['◷', 'Horas de falta registradas', hours(absent)],
    ['♡', 'Matérias em atenção (≥15%)', `${risk} <small>de ${subjects.length}</small>`]
  ].map(x => `<article class="stat-card"><span class="stat-icon">${x[0]}</span><p>${x[1]}</p><strong>${x[2]}</strong></article>`).join('');

  const alerts = subjects.map(s => {
    const t = totals(s);
    const pct = t.total > 0 ? (t.absent / t.total) * 100 : 0;
    return { s, t, pct };
  }).filter(x => x.pct >= 15);

  $('#alertSection').hidden = !alerts.length;
  $('#alertsList').innerHTML = alerts.map(({ s, t, pct }) => {
    const roundedPct = Math.round(pct);
    if (t.absent >= t.allowed) {
      return `<div class="alert"><strong>${s.name}:</strong> você atingiu o limite máximo de faltas (${hours(t.absent)} de ${hours(t.allowed)} permitidas).</div>`;
    }
    return `<div class="alert"><strong>${s.name}:</strong> você atingiu ${roundedPct}% de faltas na matéria (${hours(t.absent)} de ${hours(t.total)}). Faltam somente ${hours(t.allowed - t.absent)} para o limite máximo (${hours(t.allowed)}).</div>`;
  }).join('');

  renderCalendar();
  const grid = $('#subjectsGrid');
  grid.innerHTML = '';
  subjects.forEach(s => {
    const t = totals(s);
    const p = t.allowed ? Math.min((t.absent / t.allowed) * 100, 100) : 0;
    const c = $('#subjectTemplate').content.cloneNode(true);
    c.querySelector('.subject-card').id = `subject-${s.id}`;
    c.querySelector('.subject-dot').style.background = s.color;
    c.querySelector('.subject-name').textContent = s.name;
    c.querySelector('.subject-schedule').textContent = `${(s.days || []).map(d => {
      const dayObj = daysOfWeek.find(x => x.id === +d.day);
      const slots = d.slots && d.slots.length
        ? d.slots
        : (d.start ? [{ start: d.start, end: d.end }] : []);
      const timesStr = slots.map(sl => `${sl.start}-${sl.end}`).join(', ');
      return `${dayObj?.short || ''}${timesStr ? ` (${timesStr})` : ''}`;
    }).join(' · ')}  •  ${t.total}h de carga horária`;
    c.querySelector('.absence-ratio').textContent = `${hours(t.absent)} de ${hours(t.allowed)}`;
    const bar = c.querySelector('.progress-bar');
    const color = `hsl(${Math.max(0, 145 - p * 1.45)} 68% 47%)`;
    bar.style.width = `${p}%`;
    bar.style.background = color;

    // Atualiza o gráfico de pizza (donut SVG)
    const pieFill = c.querySelector('.pie-fill');
    const pieText = c.querySelector('.pie-text');
    const circumference = 106.81;
    const offset = circumference - (circumference * (p / 100));
    if (pieFill) {
      pieFill.style.strokeDashoffset = offset;
      pieFill.style.stroke = color;
    }
    if (pieText) {
      pieText.textContent = `${Math.round(p)}%`;
      pieText.style.color = p >= 100 ? 'var(--danger)' : 'var(--ink)';
    }

    c.querySelector('.remaining-text').textContent = t.absent >= t.allowed ? 'Limite de faltas atingido.' : `Você ainda pode faltar ${hours(t.allowed - t.absent)}.`;
    c.querySelector('.add-absence').textContent = '+ Registrar 1h de falta';
    c.querySelector('.remove-absence').textContent = '− Remover 1h';
    c.querySelector('.add-absence').onclick = () => change(s, 1);
    c.querySelector('.remove-absence').onclick = () => change(s, -1);
    c.querySelector('.more-button').onclick = () => subjectModal(s);
    grid.append(c);
  });
  $('#emptyState').hidden = !!subjects.length;
}

// Funções de Persistência Local (Fallback para Render & Offline)
function saveLocalUser(u) {
  try {
    localStorage.setItem('presenca_session', JSON.stringify(u));
  } catch (e) {
    console.error('Erro ao salvar usuário no localStorage:', e);
  }
}

function saveLocalSubjects(userId, list) {
  try {
    if (userId) {
      localStorage.setItem(`presenca_subjects_${userId}`, JSON.stringify(list));
    }
  } catch (e) {
    console.error('Erro ao salvar matérias no localStorage:', e);
  }
}

function getLocalSubjects(userId) {
  try {
    if (!userId) return [];
    const saved = localStorage.getItem(`presenca_subjects_${userId}`);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

async function load() {
  if (!user) return;
  profile = { name: user.name, id: user.id };
  
  // Tenta buscar matérias no servidor
  try {
    const res = await fetch(`/api/subjects/${user.id}`);
    if (res.ok) {
      subjects = await res.json();
      saveLocalSubjects(user.id, subjects);
    } else {
      // Se o servidor no Render reiniciar ou resetar, carrega o backup local
      subjects = getLocalSubjects(user.id);
    }
  } catch (err) {
    console.warn('[PWA] Servidor offline ou indisponível. Carregando dados locais:', err);
    subjects = getLocalSubjects(user.id);
  }
  render();
}

async function change(s, n) {
  const v = Math.max(0, +s.absence_count + n);
  s.absence_count = v;
  saveLocalSubjects(user.id, subjects);
  render();

  try {
    await fetch(`/api/subjects/${s.id}/absence`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ absence_count: v })
    });
  } catch (err) {
    console.warn('[PWA] Falha ao sincronizar falta com o servidor, salva localmente.');
  }
}

async function remove(s) {
  if (!confirm(`Excluir a matéria "${s.name}"?`)) return;
  subjects = subjects.filter(x => x.id !== s.id);
  saveLocalSubjects(user.id, subjects);
  render();

  try {
    await fetch(`/api/subjects/${s.id}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('[PWA] Falha ao excluir matéria no servidor, excluída localmente.');
  }
}

$('#todayText').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now).replace(/^./, c => c.toUpperCase());

$('#openSubjectModal').onclick = () => subjectModal();
$('#emptyNewSubject').onclick = () => subjectModal();

$('#tabLogin').onclick = () => {
  signup = false;
  authView();
  message('');
};
$('#tabSignup').onclick = () => {
  signup = true;
  authView();
  message('');
};

$('#userModal')?.addEventListener('cancel', e => {
  if (!user) e.preventDefault();
});

document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', e => {
    if (e.target === dialog) {
      if (dialog.id === 'userModal' && !user) return;
      dialog.close();
    }
  });
});

document.querySelectorAll('[data-close]').forEach(x => x.onclick = () => $('#' + x.dataset.close).close());

$('#switchUserButton').onclick = () => {
  localStorage.removeItem('presenca_session');
  sessionStorage.removeItem('presenca_session');
  user = null;
  profile = null;
  subjects = [];
  render();
};

$('#userForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('#userEmail').value.trim().toLowerCase();
  const password = $('#userPassword').value;

  const endpoint = signup ? '/api/auth/register' : '/api/auth/login';
  const payload = signup
    ? { name: $('#userName').value.trim(), email, password }
    : { email, password };

  $('#authSubmit').disabled = true;
  message('Processando...');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    $('#authSubmit').disabled = false;

    if (!res.ok) {
      return message(data.error || 'Erro na operação.');
    }

    user = data;
    saveLocalUser(user);
    message('');
    load();
  } catch (err) {
    $('#authSubmit').disabled = false;
    // Fallback: se o servidor estiver inacessível ou reiniciando no Render
    user = { id: `local_${Date.now()}`, name: payload.name || email.split('@')[0], email };
    saveLocalUser(user);
    message('');
    load();
  }
};

$('#subjectForm').onsubmit = async e => {
  e.preventDefault();
  const days = daysOfWeek.flatMap(d => {
    const chk = $(`[data-day="${d.id}"]`);
    if (chk && chk.checked) {
      const list = $(`#slotsList-${d.id}`);
      const rows = list ? list.querySelectorAll('.slot-row') : [];
      const slots = [];
      let totalDayHours = 0;
      rows.forEach(r => {
        const start = r.querySelector('.slot-start').value || '18:30';
        const end = r.querySelector('.slot-end').value || '20:30';
        const hours = calcHours(start, end);
        slots.push({ start, end, hours });
        totalDayHours += hours;
      });
      return [{ day: d.id, slots, hours: totalDayHours, start: slots[0]?.start, end: slots[0]?.end }];
    }
    return [];
  });
  if (!days.length) return alert('Escolha pelo menos um dia.');

  const id = e.currentTarget.dataset.id;
  const targetId = id || `sub_${Date.now()}`;
  const payload = {
    id: targetId,
    user_id: user.id,
    name: $('#subjectName').value.trim(),
    color: $('#subjectColor').value,
    absence_limit: +$('#subjectLimit').value,
    total_hours: +$('#subjectTotalHours').value,
    days,
    absence_count: id ? (subjects.find(s => s.id === id)?.absence_count || 0) : 0
  };

  // Atualiza estado local imediatamente
  if (id) {
    subjects = subjects.map(s => s.id === id ? payload : s);
  } else {
    subjects.push(payload);
  }
  saveLocalSubjects(user.id, subjects);
  $('#subjectModal').close();
  render();

  // Tenta sincronizar com o servidor em background
  try {
    await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('[PWA] Matéria salva localmente (offline/servidor em repouso).');
  }
};

// Carrega sessão ativa se existir no localStorage
(() => {
  try {
    const saved = localStorage.getItem('presenca_session') || sessionStorage.getItem('presenca_session');
    if (saved) {
      user = JSON.parse(saved);
      load();
    } else {
      render();
    }
  } catch {
    render();
  }
})();

// Registra o Service Worker para suporte a PWA Offline e Instalação
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] Service Worker registrado com sucesso:', reg.scope))
      .catch(err => console.error('[PWA] Falha ao registrar Service Worker:', err));
  });
}

// Lógica para capturar e exibir o prompt de instalação do PWA
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = $('#installPwaBtn');
  if (installBtn) {
    installBtn.hidden = false;
    installBtn.onclick = async () => {
      installBtn.hidden = true;
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] Resultado da instalação:', outcome);
        deferredPrompt = null;
      }
    };
  }
});

window.addEventListener('appinstalled', () => {
  console.log('[PWA] Aplicativo Presença instalado com sucesso!');
  const installBtn = $('#installPwaBtn');
  if (installBtn) installBtn.hidden = true;
  deferredPrompt = null;
});

