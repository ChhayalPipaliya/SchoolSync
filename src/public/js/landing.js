document.addEventListener('DOMContentLoaded', () => {
    initStickyNav();
    initCounters();
    initScrollReveal();
    initSmoothScroll();
    initMobileMenu();
    initPlanDemoLinks();
});

function initStickyNav() {
    const nav = document.querySelector('.landing-nav');
    if (!nav) return;
    let lastY = 0;
    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        nav.style.boxShadow = y > 20 ? '0 2px 20px rgba(0,0,0,0.08)' : '';
        lastY = y;
    }, { passive: true });
};

function initCounters() {
    const counters = document.querySelectorAll('.hero-stat-num[data-count], [data-count]');
    if (!counters.length) return;
    const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            const raw = el.dataset.count || '0';
            const suffix = el.dataset.suffix || (raw.endsWith('+') ? '+' : raw.endsWith('%') ? '%' : '');
            const target = parseInt(raw) || 0;
            if (!target) return;
            const start = performance.now(), dur = 1600;
            
            (function tick(now) {
                const p   = Math.min((now - start) / dur, 1);
                const eas = 1 - Math.pow(1 - p, 4);
                el.textContent = Math.round(target * eas).toLocaleString('en-IN') + suffix;
                if (p <  1) requestAnimationFrame(tick);
            })(start);
            io.unobserve(el);
        });
    }, { threshold: 0.3 });
    counters.forEach(el => io.observe(el));
};

function initScrollReveal() {
    const targets = document.querySelectorAll('.landing-feature-card, .role-card, .reveal');
    if (!targets.length) return;
    
    const io = new IntersectionObserver(entries => {
        entries.forEach((e, i) => {
            if (!e.isIntersecting) return;
            setTimeout(() => {
                e.target.style.opacity  = '1';
                e.target.style.transform = 'translateY(0)';
            }, i * 60);
            io.unobserve(e.target);
        });
    }, { threshold: 0.08 });

    targets.forEach((el, i) => {
        el.style.opacity   = '0';
        el.style.transform = 'translateY(24px)';
        el.style.transition = `opacity 0.5s ease ${i * 0.04}s, transform 0.5s ease ${i * 0.04}s`;
        io.observe(el);
    });
};

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', function (e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            closeMobileMenu();
        });
    });
};

function initMobileMenu() {
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    if (!hamburger || !mobileMenu) return;
    
    hamburger.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.toggle('open');
        hamburger.innerHTML = isOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
    });
};

function closeMobileMenu() {
    const mobileMenu = document.getElementById('mobileMenu');
    const hamburger  = document.getElementById('hamburger');
    mobileMenu?.classList.remove('open');
    if (hamburger) hamburger.innerHTML = '<i class="fas fa-bars"></i>';
};

function initPlanDemoLinks() {
    const selectedPlan = document.getElementById('selected_plan_id');
    const cycleInput = document.getElementById('selected_billing_cycle');
    const planLinks = document.querySelectorAll('.plan-demo-link');

    planLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (selectedPlan) selectedPlan.value = link.dataset.planId || '';
            if (cycleInput) {
                const yearlyActive = document.getElementById('btn-yearly')?.classList.contains('active');
                cycleInput.value = yearlyActive ? 'yearly' : 'monthly';
            };
        });
    });
};