/* Bob Agents — client interactions */

/* Year */
(function () {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

/* Scroll progress */
(function () {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  const update = () => {
    const h = document.documentElement;
    const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, scrolled))})`;
  };
  bar.style.transformOrigin = 'left';
  bar.style.transform = 'scaleX(0)';
  bar.style.position = 'fixed';
  bar.style.top = '0';
  bar.style.left = '0';
  bar.style.right = '0';
  bar.style.height = '2px';
  bar.style.background = 'var(--green)';
  bar.style.zIndex = '60';
  window.addEventListener('scroll', update, { passive: true });
  update();
})();

/* Reveal on scroll */
(function () {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach((el) => io.observe(el));
})();

/* Mobile menu */
(function () {
  const toggle = document.getElementById('menuToggle');
  const menu = document.getElementById('mobileMenu');
  if (!toggle || !menu) return;
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
  });
  menu.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    })
  );
})();

/* Topbar active link tracking */
(function () {
  const links = document.querySelectorAll('.topbar nav a');
  if (!links.length) return;
  const sections = [];
  links.forEach((l) => {
    const id = l.getAttribute('href');
    if (id && id.startsWith('#')) {
      const el = document.querySelector(id);
      if (el) sections.push({ el, link: l });
    }
  });
  if (!sections.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const s = sections.find((x) => x.el === e.target);
        if (s) {
          links.forEach((l) => l.classList.remove('is-active'));
          s.link.classList.add('is-active');
        }
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  sections.forEach((s) => io.observe(s.el));
})();

/* Console sidebar active + crumb */
(function () {
  const links = document.querySelectorAll('.app-sidebar a[data-view]');
  const crumb = document.getElementById('crumbCur');
  if (!links.length) return;
  links.forEach((l) => {
    l.addEventListener('click', () => {
      links.forEach((x) => x.classList.remove('is-active'));
      l.classList.add('is-active');
      if (crumb) crumb.textContent = l.dataset.view;
    });
  });
})();

/* Live tick on landing KPIs */
(function () {
  const kTasks = document.getElementById('kTasks');
  const kRunning = document.getElementById('kRunning');
  if (!kTasks) return;
  let tasks = 12847;
  setInterval(() => {
    tasks += Math.floor(Math.random() * 7);
    kTasks.textContent = tasks.toLocaleString();
    if (kRunning) {
      const r = 3 + (Math.random() > 0.7 ? 1 : 0);
      kRunning.textContent = r;
    }
  }, 2500);
})();

/* Live tick on console KPIs */
(function () {
  const cTasks = document.getElementById('cTasks');
  const cRunning = document.getElementById('cRunning');
  if (!cTasks) return;
  let tasks = 534;
  setInterval(() => {
    tasks = 500 + Math.floor(Math.random() * 80);
    cTasks.textContent = tasks;
    if (cRunning) cRunning.textContent = 3 + (Math.random() > 0.8 ? 1 : 0);
  }, 2000);
})();

/* Append live run lines occasionally */
(function () {
  const stream = document.getElementById('runStream');
  if (!stream) return;
  const agents = ['triage-bot', 'code-reviewer', 'support-agent', 'data-pipeline'];
  const msgs = ['classified batch', 'opened PR', 'resolved ticket', 'synced rows', 'checked envs'];
  const models = ['gpt-4o', 'claude-3.5', 'gpt-4o-mini'];
  setInterval(() => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    const id = 'run_' + Math.random().toString(36).slice(2, 6);
    const a = agents[Math.floor(Math.random() * agents.length)];
    const m = msgs[Math.floor(Math.random() * msgs.length)];
    const model = models[Math.floor(Math.random() * models.length)];
    const row = document.createElement('div');
    row.className = 'rs-row';
    row.innerHTML = `<span class="id">${id}</span><span class="msg">${a} · ${m}</span><span class="agent">${model}</span><span class="time">${ts}</span>`;
    stream.insertBefore(row, stream.firstChild);
    while (stream.children.length > 8) stream.removeChild(stream.lastChild);
  }, 3500);
})();

/* Log tail append */
(function () {
  const log = document.getElementById('logTail');
  if (!log) return;
  const lines = [
    ['info', 'checkpoint saved'],
    ['ok', 'task completed'],
    ['info', 'tool call finished'],
    ['warn', 'rate limit 75%'],
  ];
  setInterval(() => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    const [lvl, body] = lines[Math.floor(Math.random() * lines.length)];
    const cls = lvl === 'ok' ? 'ok' : lvl === 'warn' ? 'warn' : 'info';
    const div = document.createElement('div');
    div.className = 'l';
    div.innerHTML = `<span class="ts">${ts}</span> <span class="lvl ${cls}">${lvl.toUpperCase()}</span>  ${body}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 24) log.removeChild(log.firstChild);
  }, 2000);
})();

/* CP log on landing append */
(function () {
  const log = document.getElementById('cpLog');
  if (!log) return;
  const lines = [
    ['lvl-ok', 'OK', 'agent completed task'],
    ['lvl-info', 'INFO', 'tool call dispatched'],
    ['lvl-warn', 'WARN', 'latency spike detected'],
  ];
  setInterval(() => {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    const [cls, lvl, body] = lines[Math.floor(Math.random() * lines.length)];
    const div = document.createElement('div');
    div.className = 'line';
    div.innerHTML = `<span class="ts">${ts}</span> <span class="${cls}">${lvl}</span> ${body}`;
    log.appendChild(div);
    while (log.children.length > 7) log.removeChild(log.firstChild);
  }, 2800);
})();
