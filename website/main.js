(() => {
  const body = document.body;
  body.classList.add('js-ready');

  const header = document.querySelector('[data-header]');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav]');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const closeNav = () => {
    header?.classList.remove('nav-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', '打开导航');
  };

  menuToggle?.addEventListener('click', () => {
    const open = header?.classList.toggle('nav-open') ?? false;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  });

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeNav);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header?.classList.contains('nav-open')) {
      closeNav();
      menuToggle?.focus();
    }
  });

  const onScrollHeader = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  onScrollHeader();
  window.addEventListener('scroll', onScrollHeader, { passive: true });

  const navLinks = [...(nav?.querySelectorAll('a[href^="#"]') ?? [])];
  const spyTargets = navLinks
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (spyTargets.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((link) => {
            const active = link.getAttribute('href') === `#${entry.target.id}`;
            if (active) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        });
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    spyTargets.forEach((section) => spy.observe(section));
  }

  const revealNodes = [...document.querySelectorAll('.reveal, [data-stagger]')];
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealNodes.forEach((node) => node.classList.add('in-view'));
  } else if (revealNodes.length) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
    );
    revealNodes.forEach((node) => revealObserver.observe(node));
  }

  const heroSection = document.querySelector('.hero');
  const deviceBack = document.querySelector('.hero-device-back');
  const deviceFront = document.querySelector('.hero-device-front');
  if (heroSection && deviceBack && deviceFront && !reducedMotion) {
    let ticking = false;
    const applyParallax = () => {
      ticking = false;
      const rect = heroSection.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const progress = Math.min(Math.max(-rect.top / rect.height, 0), 1);
      deviceBack.style.transform = `rotate(-6deg) translateY(${progress * 26}px)`;
      deviceFront.style.transform = `rotate(4deg) translateY(${progress * -34}px)`;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(applyParallax);
        }
      },
      { passive: true },
    );
  }

  const shots = {
    chat: {
      number: '01',
      label: 'CHAT / MATERIAL LIGHT',
      date: 'SIMULATOR · 2026.08.26',
      image: './assets/screens/chat-material-light.png',
      alt: 'IsleMind Android 模拟器 Material 主题聊天工作区',
      caption: '最近一次模拟器演示中的聊天工作区，展示模型、消息与输入区的真实状态。',
      title: '真正的应用画面，而不是占位稿。',
      description: '模型、消息、引用与输入区在同一条工作流中。你可以在 Android 上直接开始对话，再把它交给知识或任务工作区继续处理。',
      points: ['Material 3 主题与清晰状态层级', '模型、上下文与回复保持在同一视图', '来自 Android 模拟器演示模式'],
    },
    diagnostics: {
      number: '02',
      label: 'RUNTIME / DIAGNOSTICS',
      date: 'SIMULATOR · 2026.08.24',
      image: './assets/screens/provider-diagnostics.png',
      alt: 'IsleMind Android 模拟器运行诊断界面',
      caption: '运行诊断页把响应、compact、provider health 与时间线状态集中展示。',
      title: '运行状态有出处，问题有路径。',
      description: '从请求响应到 provider health，关键状态都能被检查。发生异常时，你看到的是可行动的诊断，而不是模糊的加载状态。',
      points: ['Provider runtime 健康检查', '响应、fallback 与时间线状态', '来自 Android 模拟器测试证据'],
    },
    themes: {
      number: '03',
      label: 'SYSTEM / THEMES',
      date: 'SIMULATOR · 2026.08.26',
      image: './assets/screens/settings-themes-dark.png',
      alt: 'IsleMind Android 模拟器主题系统设置界面',
      caption: '主题系统支持极简、莫奈、Material 3 与液态玻璃，并可独立选择明暗模式。',
      title: '界面系统，跟着你的工作方式变化。',
      description: '主题、强调色、明暗模式与语言设置都在应用内提供明确入口，保持工作区的结构不变，只改变它的气质。',
      points: ['四套主题与三种界面语言', '明暗模式与强调色独立配置', '来自 Android 模拟器演示模式'],
    },
  };

  const tabs = [...document.querySelectorAll('[data-shot-tab]')];
  const image = document.querySelector('[data-shot-image]');
  const label = document.querySelector('[data-shot-label]');
  const date = document.querySelector('[data-shot-date]');
  const number = document.querySelector('[data-shot-number]');
  const title = document.querySelector('[data-shot-title]');
  const description = document.querySelector('[data-shot-description]');
  const caption = document.querySelector('[data-shot-caption]');
  const points = document.querySelector('[data-shot-points]');

  const setShot = (key) => {
    const shot = shots[key] ?? shots.chat;
    tabs.forEach((tab) => {
      const active = tab.dataset.shotTab === key;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    if (image) {
      image.classList.add('is-switching');
      window.setTimeout(() => {
        image.src = shot.image;
        image.alt = shot.alt;
        image.classList.remove('is-switching');
      }, 120);
    }
    if (label) label.textContent = shot.label;
    if (date) date.textContent = shot.date;
    if (number) number.textContent = shot.number;
    if (title) title.textContent = shot.title;
    if (description) description.textContent = shot.description;
    if (caption) caption.textContent = shot.caption;
    if (points) {
      points.innerHTML = shot.points.map((point) => `<li><svg class="icon" aria-hidden="true"><use href="#icon-check" /></svg>${point}</li>`).join('');
    }
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => setShot(tab.dataset.shotTab)));

  const releaseVersionNodes = [...document.querySelectorAll('[data-release-version]')];
  const releaseVersionCodeNodes = [...document.querySelectorAll('[data-release-version-code]')];
  const latestReleaseUrl = 'https://github.com/domidoremi/IsleMind/releases/latest';
  const releaseLinks = [...document.querySelectorAll('[data-release-link]')];

  const normalizeReleaseTag = (tag) => {
    if (typeof tag !== 'string' || !tag.trim()) return null;
    const value = tag.trim();
    return value.toLowerCase().startsWith('v') ? value : `v${value}`;
  };

  const loadReleaseMetadata = async () => {
    try {
      const response = await fetch('./site-meta.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
      return await response.json();
    } catch {
      return { version: '1.0.21', versionCode: 121 };
    }
  };

  const renderReleaseMetadata = async () => {
    const metadata = await loadReleaseMetadata();
    const version = normalizeReleaseTag(metadata.version) || 'v1.0.21';
    releaseVersionNodes.forEach((node) => { node.textContent = version; });
    releaseVersionCodeNodes.forEach((node) => { node.textContent = String(metadata.versionCode ?? 121); });
    releaseLinks.forEach((link) => { link.href = latestReleaseUrl; });
  };

  void renderReleaseMetadata();

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
