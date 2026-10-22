/* Bob Agents — client interactions */

/* Year */
(function () {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();

/* Hero parallax + scroll effects + mouse follow */
(function () {
  const hero = document.getElementById('home');
  const consolePreview = document.querySelector('.console-preview');
  const heroCopy = document.querySelector('.hero-copy');
  if (!hero || !consolePreview) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mouseX = 0, mouseY = 0;
  let currentX = 0, currentY = 0;

  function onScroll() {
    if (prefersReduced) return;
    const rect = hero.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    if (rect.bottom <= 0 || rect.top >= vpHeight) return;

    const progress = 1 - Math.max(0, Math.min(1, rect.bottom / (rect.height + vpHeight)));
    consolePreview.style.transform = `translateY(${progress * 40}px) translateX(${currentX}px) translateY(${currentY}px)`;
    if (heroCopy) {
      heroCopy.style.opacity = 1 - progress * 0.15;
    }
    hero.style.backgroundPositionY = `${progress * 100}px`;
  }

  function onMouseMove(e) {
    if (prefersReduced) return;
    const rect = hero.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    mouseX = (e.clientX - centerX) / 30; // max ~16px
    mouseY = (e.clientY - centerY) / 30;
  }

  function animate() {
    if (prefersReduced) return;
    currentX += (mouseX - currentX) * 0.1;
    currentY += (mouseY - currentY) * 0.1;
    if (Math.abs(currentX) > 0.1 || Math.abs(currentY) > 0.1) {
      consolePreview.style.transform = `translateY(${currentY}px) translateX(${currentX}px)`;
    }
    requestAnimationFrame(animate);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  hero.addEventListener('mousemove', onMouseMove, { passive: true });
  hero.addEventListener('mouseleave', () => { mouseX = 0; mouseY = 0; });
  animate();
  onScroll();
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
    const s1 = document.createElement('span'); s1.className = 'id'; s1.textContent = id;
    const s2 = document.createElement('span'); s2.className = 'msg'; s2.textContent = a + ' · ' + m;
    const s3 = document.createElement('span'); s3.className = 'agent'; s3.textContent = model;
    const s4 = document.createElement('span'); s4.className = 'time'; s4.textContent = ts;
    row.append(s1, s2, s3, s4);
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
    const t = document.createElement('span'); t.className = 'ts'; t.textContent = ts;
    const l = document.createElement('span'); l.className = 'lvl ' + cls; l.textContent = lvl.toUpperCase();
    const b = document.createTextNode('  ' + body);
    div.append(t, document.createTextNode(' '), l, b);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 24) log.removeChild(log.firstChild);
  }, 2000);
})();

/* Secret toast + Konami easter egg */
(function () {
  const toast = document.getElementById('secretToast');
  if (!toast) return;
  const show = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3200);
  };

  // Konami code
  const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let buf = [];
  window.addEventListener('keydown', (e) => {
    buf.push(e.key);
    if (buf.length > seq.length) buf.shift();
    if (buf.join(',') === seq.join(',')) {
      buf = [];
      show('🎉 Secret agent unlocked: you found the Konami code.');
      matrixRain();
    }
    // "/" opens a tiny command hint
    if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
      const t = document.activeElement && document.activeElement.tagName;
      if (t !== 'INPUT' && t !== 'TEXTAREA') {
        e.preventDefault();
        show('Tip: press ↑↑↓↓←→←→ B A for a surprise.');
      }
    }
  });

  function matrixRain() {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.zIndex = '9999';
    canvas.style.pointerEvents = 'none';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const cols = Math.floor(canvas.width / 16);
    const drops = Array.from({ length: cols }, () => Math.random() * canvas.height);
    const chars = 'BOB/AGENTS01'.split('');
    let frames = 0;
    const id = setInterval(() => {
      ctx.fillStyle = 'rgba(7,11,15,0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#4ade80';
      ctx.font = '14px "JetBrains Mono", monospace';
      for (let i = 0; i < cols; i++) {
        const c = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(c, i * 16, drops[i]);
        drops[i] += 16;
        if (drops[i] > canvas.height && Math.random() > 0.975) drops[i] = 0;
      }
      frames++;
      if (frames > 90) {
        clearInterval(id);
        canvas.style.transition = 'opacity 400ms linear';
        canvas.style.opacity = '0';
        setTimeout(() => canvas.remove(), 450);
      }
    }, 40);
  }
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
    const t = document.createElement('span'); t.className = 'ts'; t.textContent = ts;
    const l = document.createElement('span'); l.className = cls; l.textContent = lvl;
    const b = document.createTextNode(' ' + body);
    div.append(t, document.createTextNode(' '), l, b);
    log.appendChild(div);
    while (log.children.length > 7) log.removeChild(log.firstChild);
  }, 2800);
})();
