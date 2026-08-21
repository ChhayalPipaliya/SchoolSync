document.addEventListener('DOMContentLoaded', () => {
    initCustomCursor();
    initStickyNav();
    initSmoothScroll();
    initMobileMenu();
    initScrollReveal();
    initCounters();
    initHero3DTilt();
    initHeroCanvas();
    initFAQAccordion();
    initBackToTop();
    initCookieBanner();
    initPlanDemoLinks();
    initPlanFeatureModal();
});

function initStickyNav() {
    const nav = document.getElementById('nav') || document.querySelector('.landing-nav');
    if (!nav) return;

    const sections = document.querySelectorAll('section[id], main > [id]');
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"], .mobile-menu a[href^="#"]');

    let ticking = false;
    function updateNav() {
        const y = window.scrollY;
        nav.classList.toggle('scrolled', y > 20);

        let currentSectionId = '';
        sections.forEach(section => {
            const top = section.offsetTop - 120;
            const height = section.offsetHeight;
            if (y >= top && y < top + height) {
                currentSectionId = section.getAttribute('id');
            }
        });

        if (currentSectionId) {
            navLinks.forEach(link => {
                const href = link.getAttribute('href');
                if (href === `#${currentSectionId}`) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }

        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(updateNav);
            ticking = true;
        }
    }, { passive: true });

    updateNav();
}

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href) return;

            if (href === '#' || href === '#top') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                closeMobileMenu();
                return;
            }

            let target = document.querySelector(href);
            if (!target && href === '#contact') {
                target = document.getElementById('cta') || document.querySelector('.cta-section');
            }

            if (!target) return;

            e.preventDefault();
            const nav = document.getElementById('nav') || document.querySelector('.landing-nav');
            const navHeight = nav ? nav.offsetHeight + 16 : 80;
            const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight;

            window.scrollTo({
                top: Math.max(0, targetPosition),
                behavior: 'smooth'
            });

            closeMobileMenu();
        });
    });
}

function initMobileMenu() {
    const menuBtn = document.querySelector('.mobile-menu-btn') || document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobile-menu') || document.getElementById('mobileMenu');
    if (!menuBtn || !mobileMenu) return;

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = mobileMenu.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', isOpen);
        menuBtn.innerHTML = isOpen ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
    });

    document.addEventListener('click', (e) => {
        if (!mobileMenu.contains(e.target) && !menuBtn.contains(e.target) && mobileMenu.classList.contains('open')) {
            closeMobileMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
            closeMobileMenu();
        }
    });
}

function closeMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu') || document.getElementById('mobileMenu');
    const menuBtn = document.querySelector('.mobile-menu-btn') || document.getElementById('hamburger');
    if (mobileMenu) mobileMenu.classList.remove('open');
    if (menuBtn) {
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }
}

function initScrollReveal() {
    const targets = document.querySelectorAll('.reveal, .reveal-scale, .landing-feature-card');
    if (!targets.length) return;

    if (!('IntersectionObserver' in window)) {
        targets.forEach(el => el.classList.add('visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.08,
        rootMargin: '0px 0px -40px 0px'
    });

    targets.forEach(el => observer.observe(el));
}

function initCounters() {
    const statElements = [
        { el: document.getElementById('c1'), target: 8, duration: 1800 },
        { el: document.getElementById('c2'), target: 12, duration: 1800 },
        { el: document.getElementById('c3'), target: 99.9, duration: 1800, decimal: true },
        { el: document.getElementById('c4'), target: 45, duration: 1800 }
    ];

    const dataCountElements = document.querySelectorAll('.hero-stat-num[data-count], [data-count]');
    dataCountElements.forEach(el => {
        const raw = el.dataset.count || '0';
        const target = parseFloat(raw);
        if (!isNaN(target)) {
            statElements.push({
                el,
                target,
                duration: 1800,
                decimal: raw.includes('.'),
                suffix: el.dataset.suffix || (raw.endsWith('+') ? '+' : raw.endsWith('%') ? '%' : '')
            });
        }
    });

    let started = false;
    function runCounters() {
        if (started) return;
        started = true;

        statElements.forEach(item => {
            if (!item.el) return;
            const start = performance.now();
            const suffix = item.suffix || '';

            function update(now) {
                const elapsed = now - start;
                const progress = Math.min(elapsed / item.duration, 1);
                const eased = 1 - Math.pow(1 - progress, 4);
                const val = eased * item.target;

                if (item.decimal) {
                    item.el.textContent = val.toFixed(1) + suffix;
                } else {
                    item.el.textContent = Math.round(val).toLocaleString('en-IN') + suffix;
                }

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    item.el.textContent = (item.decimal ? item.target.toFixed(1) : item.target.toLocaleString('en-IN')) + suffix;
                }
            }
            requestAnimationFrame(update);
        });
    }

    const triggerSection = document.querySelector('.stats-bar') || document.querySelector('.hero-micro-stats');
    if (triggerSection && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                runCounters();
                io.disconnect();
            }
        }, { threshold: 0.15 });
        io.observe(triggerSection);
    } else {
        setTimeout(runCounters, 1000);
    }
}

function initHero3DTilt() {
    const heroRight = document.querySelector('.hero-right');
    const heroMockup = document.getElementById('heroMockup') || document.querySelector('.hero-mockup-container');
    if (!heroRight || !heroMockup) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    function render() {
        currentX += (targetX - currentX) * 0.08;
        currentY += (targetY - currentY) * 0.08;
        heroMockup.style.transform = `perspective(1000px) rotateX(${currentX}deg) rotateY(${currentY}deg)`;
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    heroRight.addEventListener('mousemove', (e) => {
        const rect = heroRight.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        targetX = (y - centerY) / 36;
        targetY = (centerX - x) / 36;
    }, { passive: true });

    heroRight.addEventListener('mouseleave', () => {
        targetX = 0;
        targetY = 0;
    });
};

function initHeroCanvas() {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas || window.innerWidth < 768) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let animationId = null;
    let mouseX = -1000;
    let mouseY = -1000;
    let isVisible = true;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }, { passive: true });

    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 1;
            this.speedX = (Math.random() - 0.5) * 0.35;
            this.speedY = (Math.random() - 0.5) * 0.35;
            this.opacity = Math.random() * 0.4 + 0.15;
        };
        update() {
            this.x += this.speedX;
            this.y += this.speedY;

            const dx = mouseX - this.x;
            const dy = mouseY - this.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 22500) {
                this.x -= dx * 0.012;
                this.y -= dy * 0.012;
            };

            if (this.x < 0) this.x = canvas.width;
            if (this.x > canvas.width) this.x = 0;
            if (this.y < 0) this.y = canvas.height;
            if (this.y > canvas.height) this.y = 0;
        };
        draw() {
            ctx.fillStyle = `rgba(99, 102, 241, ${this.opacity})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        };
    };

    const count = Math.min(Math.floor(window.innerWidth / 22), 65);
    particles = Array.from({ length: count }, () => new Particle());

    function animate() {
        if (!isVisible) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.update();
            p.draw();

            for (let j = i + 1; j < particles.length; j++) {
                const p2 = particles[j];
                const dx = p.x - p2.x;
                const dy = p.y - p2.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < 16900) { // 130px
                    const dist = Math.sqrt(distSq);
                    ctx.strokeStyle = `rgba(99, 102, 241, ${0.16 * (1 - dist / 130)})`;
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                };
            };
        };
        animationId = requestAnimationFrame(animate);
    };

    const heroSection = document.querySelector('.hero');
    if (heroSection && 'IntersectionObserver' in window) {
        const obs = new IntersectionObserver((entries) => {
            isVisible = entries[0].isIntersecting;
            if (isVisible && !animationId) {
                animate();
            } else if (!isVisible && animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            };
        }, { threshold: 0 });
        obs.observe(heroSection);
    } else {
        animate();
    };
};

function initFAQAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    if (!faqItems.length) return;

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        if (!question) return;

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            faqItems.forEach(other => {
                if (other !== item) other.classList.remove('active');
            });
            item.classList.toggle('active', !isActive);
        });
    });
};

function initBackToTop() {
    const backToTop = document.getElementById('backToTop');
    if (!backToTop) return;

    window.addEventListener('scroll', () => {
        backToTop.classList.toggle('visible', window.scrollY > 450);
    }, { passive: true });

    backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
};

function initCookieBanner() {
    const banner = document.getElementById('cookieBanner');
    if (!banner) return;

    if (!localStorage.getItem('cookiesAccepted')) {
        setTimeout(() => banner.classList.add('show'), 2500);
    }

    document.getElementById('cookieAccept')?.addEventListener('click', () => {
        localStorage.setItem('cookiesAccepted', 'true');
        banner.classList.remove('show');
    });

    document.getElementById('cookieDecline')?.addEventListener('click', () => {
        localStorage.setItem('cookiesAccepted', 'false');
        banner.classList.remove('show');
    });
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
        };

        const modal = document.getElementById('planFeaturesModal');
        if (modal && e.target === modal) {
            closePlanModal();
        };
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePlanModal();
        };
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
    };

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
    };

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
    };

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
    };
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

function initCustomCursor() {
    const dot = document.getElementById('cursorDot') || document.querySelector('.cursor-dot');
    const outline = document.getElementById('cursorOutline') || document.querySelector('.cursor-outline');

    if (!dot || !outline) return;

    if (window.matchMedia('(pointer: coarse)').matches) {
        dot.style.display = 'none';
        outline.style.display = 'none';
        return;
    }

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let outlineX = mouseX;
    let outlineY = mouseY;
    let isVisible = false;

    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;

        dot.style.left = `${mouseX}px`;
        dot.style.top = `${mouseY}px`;

        if (!isVisible) {
            isVisible = true;
            dot.style.opacity = '1';
            outline.style.opacity = '1';
            outlineX = mouseX;
            outlineY = mouseY;
        }
    }, { passive: true });

    function renderCursor() {
        if (isVisible) {
            outlineX += (mouseX - outlineX) * 0.18;
            outlineY += (mouseY - outlineY) * 0.18;

            outline.style.left = `${outlineX}px`;
            outline.style.top = `${outlineY}px`;
        }
        requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);

    document.addEventListener('mouseover', (e) => {
        const interactive = e.target.closest('a, button, input, textarea, select, label, [role="button"], [role="link"], .btn, .faq-header, .pricing-card, .bento-card, .plan-cta-link, .cookie-btn');
        if (interactive) {
            outline.classList.add('hover');
        }
    });

    document.addEventListener('mouseout', (e) => {
        const interactive = e.target.closest('a, button, input, textarea, select, label, [role="button"], [role="link"], .btn, .faq-header, .pricing-card, .bento-card, .plan-cta-link, .cookie-btn');
        if (interactive) {
            outline.classList.remove('hover');
        }
    });

    document.addEventListener('mousedown', () => {
        dot.style.transform = 'translate(-50%, -50%) scale(1.4)';
        outline.style.transform = 'translate(-50%, -50%) scale(0.85)';
    });

    document.addEventListener('mouseup', () => {
        dot.style.transform = 'translate(-50%, -50%) scale(1)';
        outline.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    document.addEventListener('mouseleave', () => {
        dot.style.opacity = '0';
        outline.style.opacity = '0';
        isVisible = false;
    });

    document.addEventListener('mouseenter', () => {
        dot.style.opacity = '1';
        outline.style.opacity = '1';
    });
}