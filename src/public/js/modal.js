(function () {
    'use strict';

    function dispatchModalEvent(modal, eventName, relatedTarget) {
        const event = new CustomEvent(eventName, {
            detail: { relatedTarget }
        });
        Object.defineProperty(event, 'relatedTarget', {
            value: relatedTarget || null
        });
        modal.dispatchEvent(event);
    }

    function openModal(id, relatedTarget = null) {
        const modal = document.querySelector(id) || document.getElementById(id.replace('#', ''));
        if (!modal) return;
        modal.classList.add('ss-modal-open');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        dispatchModalEvent(modal, 'show.bs.modal', relatedTarget);
        dispatchModalEvent(modal, 'shown.bs.modal', relatedTarget);
    };

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('ss-modal-open');
        modal.style.display = 'none';
        document.body.style.overflow = '';
        modal.dispatchEvent(new CustomEvent('hidden.bs.modal'));
        modal.dispatchEvent(new CustomEvent('hide.bs.modal'));
    };

    window.ssModal = {
        show: function (id) { openModal(id); },
        hide: function (id) {
            const modal = document.querySelector(id) || document.getElementById(id.replace('#', ''));
            closeModal(modal);
        }
    };

    window.bootstrap = window.bootstrap || {};
    window.bootstrap.Modal = function (el) {
        const element = typeof el === 'string' ? document.querySelector(el) : el;
        return {
            show: function () { if (element) openModal('#' + element.id); },
            hide: function () { closeModal(element); },
            toggle: function () { element && element.classList.contains('ss-modal-open') ? closeModal(element) : openModal('#' + element.id); }
        };
    };
    window.bootstrap.Modal.getInstance = function (el) { return window.bootstrap.Modal(el); };

    document.addEventListener('click', function (e) {
        const trigger = e.target.closest(
            '[data-bs-toggle="modal"], [data-toggle="modal"]'
        );

        if (trigger) {
            const target = trigger.getAttribute('data-bs-target') || trigger.getAttribute('data-target');
            if (target) { e.preventDefault(); openModal(target, trigger); return; }
        };

        const dismiss = e.target.closest(
            '[data-bs-dismiss="modal"], [data-dismiss="modal"], .btn-close'
        );
        if (dismiss) {
            const modal = dismiss.closest('.modal, .ss-modal');
            closeModal(modal);
            return;
        };

        if (e.target.classList.contains('modal') && e.target.classList.contains('ss-modal-open')) {
            closeModal(e.target);
        };
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            const open = document.querySelector('.modal.ss-modal-open');
            if (open) closeModal(open);
        };
    });

})();

document.addEventListener('click', function (e) {
    const trigger = e.target.closest('[data-bs-toggle="collapse"]');
    if (!trigger) return;
    const targetSel = trigger.getAttribute('data-bs-target') || trigger.getAttribute('href');
    if (!targetSel) return;
    const target = document.querySelector(targetSel);
    if (!target) return;
    e.preventDefault();

    const isOpen = target.classList.contains('ss-collapse-open');
    if (isOpen) {
        target.style.height = target.scrollHeight + 'px';
        requestAnimationFrame(() => {
            target.style.transition = 'height 0.25s ease';
            target.style.height = '0';
        });
        target.addEventListener('transitionend', () => {
            target.classList.remove('show', 'ss-collapse-open');
            target.style.height = '';
            target.style.transition = '';
        }, { once: true });
    } else {
        target.classList.add('show', 'ss-collapse-open');
        target.style.height = '0';
        target.style.overflow = 'hidden';
        requestAnimationFrame(() => {
            target.style.transition = 'height 0.25s ease';
            target.style.height = target.scrollHeight + 'px';
        });
        target.addEventListener('transitionend', () => {
            target.style.height = '';
            target.style.transition = '';
            target.style.overflow = '';
        }, { once: true });
    };
    trigger.setAttribute('aria-expanded', !isOpen);
});

document.addEventListener('click', function (e) {
    const trigger = e.target.closest('[data-bs-toggle="tab"]');
    if (!trigger) return;
    e.preventDefault();
    const targetSel = trigger.getAttribute('data-bs-target') || trigger.getAttribute('href');
    if (!targetSel) return;

    const tabList = trigger.closest('.nav, ul, [role="tablist"]');
    if (tabList) {
        tabList.querySelectorAll('[data-bs-toggle="tab"]').forEach(t => t.classList.remove('active'));
    };
    trigger.classList.add('active');

    const tabContent = document.querySelector(trigger.closest('[role="tablist"]')?.getAttribute('data-bs-content') || '.tab-content');
    if (tabContent) {
        tabContent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active', 'show'));
        const target = tabContent.querySelector(targetSel);
        if (target) target.classList.add('active', 'show');
    };
});
