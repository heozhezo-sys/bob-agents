/* ============================================================
   Morning Field Coffee — app.js
   Navigation, scroll behavior, reveals, footer year
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Footer year ---------- */
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Mobile nav ---------- */
  const toggle = $("#menuToggle");
  const mobileMenu = $("#mobileMenu");
  if (toggle && mobileMenu) {
    const setOpen = (open) => {
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      mobileMenu.classList.toggle("is-open", open);
      mobileMenu.setAttribute("aria-hidden", String(!open));
    };
    toggle.addEventListener("click", () => {
      setOpen(!mobileMenu.classList.contains("is-open"));
    });
    // close on link click
    $$(".mobile-link, .mobile-cta", mobileMenu).forEach((link) => {
      link.addEventListener("click", () => setOpen(false));
    });
    // close on escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mobileMenu.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  /* ---------- Smooth scroll with header offset ---------- */
  const header = $("#siteHeader");
  const headerOffset = () => (header ? header.offsetHeight : 0);

  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset() - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
  });

  /* ---------- Sticky header styling ---------- */
  const onScrollHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  window.addEventListener("scroll", onScrollHeader, { passive: true });
  onScrollHeader();

  /* ---------- Scroll progress ---------- */
  const progressBar = $("#scrollProgress");
  const updateProgress = () => {
    if (!progressBar) return;
    const h = document.documentElement;
    const scrolled = h.scrollTop || document.body.scrollTop;
    const height = h.scrollHeight - h.clientHeight;
    const pct = height > 0 ? (scrolled / height) * 100 : 0;
    progressBar.style.width = pct + "%";
  };
  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();

  /* ---------- Parallax (reduced-motion aware) ---------- */
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reducedMotion) {
    const heroImg = document.querySelector(".hero-image-wrap img");
    const storyImg = document.querySelector(".story-media img");
    const parallaxTargets = [
      { el: heroImg, speed: 0.18 },
      { el: storyImg, speed: 0.12 },
    ].filter((t) => t.el);
    parallaxTargets.forEach((t) => t.el.classList.add("parallax"));

    let ticking = false;
    const applyParallax = () => {
      const sy = window.scrollY;
      parallaxTargets.forEach((t) => {
        const rect = t.el.getBoundingClientRect();
        const center = rect.top + rect.height / 2 - window.innerHeight / 2;
        t.el.style.transform = "translate3d(0, " + (center * t.speed * -0.15) + "px, 0) scale(1.06)";
      });
      ticking = false;
    };
    window.addEventListener("scroll", () => {
      if (!ticking) {
        requestAnimationFrame(applyParallax);
        ticking = true;
      }
    }, { passive: true });
    applyParallax();
  }

  /* ---------- Active nav link ---------- */
  const navLinks = $$(".nav-link");
  const sectionIds = ["home", "menu", "story", "visit"];
  const sections = sectionIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const updateActive = () => {
    const scrollPos = window.scrollY + headerOffset() + 40;
    let current = sectionIds[0];
    sections.forEach((sec) => {
      if (sec.offsetTop <= scrollPos) current = sec.id;
    });
    navLinks.forEach((l) => {
      const href = l.getAttribute("href");
      l.classList.toggle("is-active", href === "#" + current);
    });
  };
  window.addEventListener("scroll", updateActive, { passive: true });
  updateActive();

  /* ---------- Scroll reveal ---------- */
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealEls = $$(".reveal");

  if (prefersReduced) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  } else if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  }

  /* ---------- Image fallback handling ---------- */
  $$("img").forEach((img) => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      const parent = img.parentElement;
      if (parent) parent.classList.add("img-fallback");
    });
  });

  /* ---------- Theme toggle ---------- */
  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mf-theme", theme);
    [$("#themeToggle"), $("#themeToggleMobile")].forEach((btn) => {
      if (btn) btn.setAttribute("aria-pressed", String(theme === "dark"));
    });
  };
  const storedTheme = localStorage.getItem("mf-theme");
  applyTheme(storedTheme || "dark");

  [$("#themeToggle"), $("#themeToggleMobile")].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      applyTheme(current === "dark" ? "light" : "dark");
    });
  });

  /* ---------- Menu filter ---------- */
  const filterBtns = $$(".filter-btn");
  const menuCards = $$(".menu-card");
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.getAttribute("data-filter");
      filterBtns.forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      menuCards.forEach((card) => {
        const cat = card.getAttribute("data-category");
        const show = f === "all" || cat === f;
        card.classList.toggle("is-hidden", !show);
      });
    });
  });

  /* ---------- Testimonial carousel ---------- */
  const carousel = $("#testimonialCarousel");
  if (carousel) {
    const slides = $$(".carousel-track .testimonial", carousel);
    const dotsWrap = $("#testimonialDots");
    let idx = 0;
    let timer = null;
    const render = () => {
      slides.forEach((s, i) => s.classList.toggle("is-active", i === idx));
      if (dotsWrap) {
        $$(".carousel-dot", dotsWrap).forEach((d, i) => d.classList.toggle("is-active", i === idx));
      }
    };
    // build dots
    if (dotsWrap) {
      slides.forEach((_, i) => {
        const dot = document.createElement("button");
        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", "Go to testimonial " + (i + 1));
        dot.addEventListener("click", () => { idx = i; render(); restart(); });
        dotsWrap.appendChild(dot);
      });
    }
    const next = () => { idx = (idx + 1) % slides.length; render(); };
    const prev = () => { idx = (idx - 1 + slides.length) % slides.length; render(); };
    const start = () => {
      if (reducedMotion) return;
      stop();
      timer = setInterval(next, 5000);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const restart = () => { stop(); start(); };
    $("#nextTestimonial")?.addEventListener("click", () => { next(); restart(); });
    $("#prevTestimonial")?.addEventListener("click", () => { prev(); restart(); });
    carousel.addEventListener("mouseenter", stop);
    carousel.addEventListener("mouseleave", start);
    render();
    start();
  }

  /* ---------- Newsletter ---------- */
  const form = $("#newsletterForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#newsletterEmail");
      const msg = $("#newsletterMsg");
      const email = (input.value || "").trim();
      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!valid) {
        msg.textContent = "Please enter a valid email address.";
        msg.classList.remove("is-success");
        msg.classList.add("is-error");
        input.focus();
        return;
      }
      msg.textContent = "Thanks! You're on the list. (Sample — connect a real service to collect emails.)";
      msg.classList.remove("is-error");
      msg.classList.add("is-success");
      form.reset();
    });
  }

  /* ---------- Lightbox ---------- */
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightboxImg");
  const lightboxCaption = $("#lightboxCaption");
  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };
  const openLightbox = (src, alt) => {
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightboxImg.alt = alt || "";
    if (lightboxCaption) lightboxCaption.textContent = alt || "";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };
  $$(".gallery-item img").forEach((img) => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => openLightbox(img.src, img.alt));
  });
  $("#lightboxClose")?.addEventListener("click", closeLightbox);
  lightbox?.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox?.classList.contains("is-open")) closeLightbox();
  });

  /* ---------- Back to top ---------- */
  const backToTop = $("#backToTop");
  const updateBackToTop = () => {
    if (!backToTop) return;
    backToTop.classList.toggle("is-visible", window.scrollY > 500);
  };
  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();
  backToTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* ---------- Floating coffee beans ---------- */
  const beansWrap = $("#heroBeans");
  if (beansWrap) {
    const beanGlyphs = ["☕", "🫘", "☕", "🫘"];
    for (let i = 0; i < 10; i++) {
      const b = document.createElement("span");
      b.className = "bean";
      b.textContent = beanGlyphs[i % beanGlyphs.length];
      b.style.left = Math.random() * 100 + "%";
      b.style.top = Math.random() * 100 + "%";
      b.style.animationDelay = (Math.random() * 6) + "s";
      b.style.animationDuration = (10 + Math.random() * 8) + "s";
      beansWrap.appendChild(b);
    }
  }

  /* ---------- Drink quiz ---------- */
  const quizModal = $("#quizModal");
  const quizBody = $("#quizBody");
  const quizTitle = $("#quizTitle");
  const openQuiz = () => {
    if (!quizModal) return;
    quizModal.classList.add("is-open");
    quizModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    startQuiz();
  };
  const closeQuiz = () => {
    if (!quizModal) return;
    quizModal.classList.remove("is-open");
    quizModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };
  $("#quizOpen")?.addEventListener("click", openQuiz);
  $("#quizClose")?.addEventListener("click", closeQuiz);
  quizModal?.addEventListener("click", (e) => { if (e.target === quizModal) closeQuiz(); });

  const quizQuestions = [
    { q: "How are you feeling today?", opts: [
      { label: "Energized & ready to go", v: "energy" },
      { label: "Calm and cozy", v: "calm" },
      { label: "Curious, surprise me", v: "curious" },
    ]},
    { q: "Hot or iced?", opts: [
      { label: "Hot", v: "hot" },
      { label: "Iced", v: "iced" },
    ]},
    { q: "Sweetness level?", opts: [
      { label: "No sugar, pure coffee", v: "plain" },
      { label: "A little sweet", v: "sweet" },
      { label: "Creamy & indulgent", v: "creamy" },
    ]},
  ];
  let qIndex = 0;
  let answers = {};
  const recommend = (a) => {
    if (a.temp === "iced" && a.sweet === "sweet") return "Caramel Latte";
    if (a.temp === "iced" && a.sweet === "plain") return "Cold Brew";
    if (a.temp === "iced") return "Matcha Latte";
    if (a.sweet === "creamy") return "Spanish Latte";
    if (a.mood === "curious") return "Matcha Latte";
    if (a.sweet === "plain") return "Espresso";
    return "Cappuccino";
  };
  const descriptions = {
    "Espresso": "Bold and concentrated — a pure shot for purists.",
    "Spanish Latte": "Silky, sweetened, and comforting.",
    "Caramel Latte": "Iced, sweet, and layered with house caramel.",
    "Cold Brew": "Smooth and refreshing over ice.",
    "Cappuccino": "Classic, balanced, and timeless.",
    "Matcha Latte": "Earthy, creamy, and gently sweet.",
  };
  const startQuiz = () => {
    qIndex = 0; answers = {};
    renderQuestion();
  };
  const renderQuestion = () => {
    if (!quizBody) return;
    const q = quizQuestions[qIndex];
    quizTitle.textContent = q.q;
    quizBody.innerHTML = "";
    q.opts.forEach((o) => {
      const btn = document.createElement("button");
      btn.className = "quiz-option";
      btn.textContent = o.label;
      btn.addEventListener("click", () => {
        if (qIndex === 0) answers.mood = o.v;
        if (qIndex === 1) answers.temp = o.v;
        if (qIndex === 2) answers.sweet = o.v;
        qIndex++;
        if (qIndex < quizQuestions.length) renderQuestion();
        else showResult();
      });
      quizBody.appendChild(btn);
    });
  };
  const showResult = () => {
    const name = recommend(answers);
    if (!quizBody) return;
    quizTitle.textContent = "Your perfect cup";
    quizBody.innerHTML = `
      <div class="quiz-result">
        <p class="result-name">${name}</p>
        <p class="result-desc">${descriptions[name]}</p>
        <a href="#menu" class="btn btn-primary" id="quizToMenu">See on menu</a>
        <button class="btn btn-ghost" id="quizRetry" style="margin-left:8px">Try again</button>
      </div>`;
    $("#quizToMenu")?.addEventListener("click", () => { closeQuiz(); });
    $("#quizRetry")?.addEventListener("click", startQuiz);
  };

  /* ---------- Konami easter egg ---------- */
  const konami = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
  let kIdx = 0;
  const toast = $("#secretToast");
  const showToast = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-visible");
    setTimeout(() => toast.classList.remove("is-visible"), 3200);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === konami[kIdx]) {
      kIdx++;
      if (kIdx === konami.length) {
        kIdx = 0;
        document.body.classList.toggle("midnight");
        const on = document.body.classList.contains("midnight");
        showToast(on ? "☕ Secret Menu unlocked: Midnight Brew" : "Back to daylight.");
      }
    } else {
      kIdx = 0;
    }
  });

  /* ---------- Open now indicator ---------- */
  const openBadge = $("#openBadge");
  if (openBadge) {
    const now = new Date();
    const day = now.getDay(); // 0 Sun
    const mins = now.getHours() * 60 + now.getMinutes();
    const weekday = day >= 1 && day <= 5;
    const openMin = weekday ? 7 * 60 : 8 * 60;
    const closeMin = weekday ? 20 * 60 : 21 * 60;
    const isOpen = mins >= openMin && mins < closeMin;
    const dot = openBadge.querySelector(".open-dot");
    const txt = openBadge.querySelector(".open-text");
    if (dot) dot.classList.toggle("is-closed", !isOpen);
    if (txt) {
      txt.textContent = isOpen ? "Open now" : "Closed now";
      txt.classList.toggle("is-closed", !isOpen);
    }
  }
})();
