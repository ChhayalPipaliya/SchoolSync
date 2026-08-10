document.addEventListener('DOMContentLoaded', () => {
    initStickyNav();
    initCounters();
    initScrollReveal();
    initSmoothScroll();
    initMobileMenu();
    initPlanDemoLinks();
    initPlanFeatureModal();
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
                const p = Math.min((now - start) / dur, 1);
                const eas = 1 - Math.pow(1 - p, 4);
                el.textContent = Math.round(target * eas).toLocaleString('en-IN') + suffix;
                if (p < 1) requestAnimationFrame(tick);
            })(start);
            io.unobserve(el);
        });
    }, { threshold: 0.3 });
    counters.forEach(el => io.observe(el));
};

function initScrollReveal() {
    const targets = document.querySelectorAll('.landing-feature-card, .reveal');
    if (!targets.length) return;

    const io = new IntersectionObserver(entries => {
        entries.forEach((e, i) => {
            if (!e.isIntersecting) return;
            setTimeout(() => {
                e.target.style.opacity = '1';
                e.target.style.transform = 'translateY(0)';
            }, i * 60);
            io.unobserve(e.target);
        });
    }, { threshold: 0.08 });

    targets.forEach((el, i) => {
        el.style.opacity = '0';
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
    const hamburger = document.getElementById('hamburger');
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

function initPlanFeatureModal() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.plan-view-all-features, .view-all-features-btn');
        if (btn) {
            e.preventDefault();
            const planKey = btn.dataset.planKey || btn.getAttribute('data-plan-key');
            if (planKey) openPlanModalByKey(planKey);
            return;
        }

        const modal = document.getElementById('planFeaturesModal');
        if (modal && e.target === modal) {
            closePlanModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePlanModal();
        }
    });
};

function openPlanModalByKey(planKey) {
    const modal = document.getElementById('planFeaturesModal');
    const dataScript = document.getElementById('plan-data-' + planKey);
    if (!modal || !dataScript) return;

    let planData = {};
    try {
        planData = JSON.parse(dataScript.textContent);
    } catch (e) {
        console.error('Failed to parse plan data JSON:', e);
        return;
    }

    const titleEl = document.getElementById('planFeaturesModalTitle');
    const priceEl = document.getElementById('planFeaturesModalPrice');
    const limitEl = document.getElementById('planFeaturesModalStudentLimit');
    const listEl = document.getElementById('planFeaturesModalList');
    const ctaEl = document.getElementById('planFeaturesModalChoosePlan');

    const isYearly = window.currentActiveCycle === 'yearly' || document.getElementById('btn-yearly')?.classList.contains('active');

    if (titleEl) titleEl.textContent = planData.name || '';
    if (priceEl) priceEl.innerHTML = isYearly ? planData.yearlyPrice : planData.monthlyPrice;
    if (limitEl) limitEl.textContent = planData.studentLimit || '';
    if (ctaEl) {
        const ctaUrl = isYearly ? planData.ctaUrlYearly : planData.ctaUrlMonthly;
        ctaEl.href = ctaUrl;
        ctaEl.setAttribute('href', ctaUrl);
        ctaEl.setAttribute('data-plan', planKey);
    }

    if (listEl) {
        listEl.innerHTML = '';
        (planData.features || []).forEach(featureName => {
            const li = document.createElement('li');
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-check check';
            icon.setAttribute('aria-hidden', 'true');
            li.appendChild(icon);
            li.appendChild(document.createTextNode(' ' + featureName));
            listEl.appendChild(li);
        });
    }

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = 'hidden';

    modal.hidden = false;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
};

function openPlanModal(btn) {
    const key = btn.dataset.planKey || btn.getAttribute('data-plan-key');
    if (key) openPlanModalByKey(key);
};

function closePlanModal() {
    const modal = document.getElementById('planFeaturesModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    modal.hidden = true;

    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
};