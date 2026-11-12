// The home page. The front panel shows the word of the choice that has the pointer or the keyboard focus,
// and goes back to the neutral word when it leaves. The five steps become a stepper: the shown step moves on
// by itself once through (never in a loop), stops on hover, focus and the pause button, and does not start at
// all for a visitor who asked for less motion. Nothing is fetched and no markup is built; the words are put
// in with textContent and the panel is the markup that index.html already has.
(function () {
    'use strict';

    // keep in step with the fill animation of .step-bar in home.css
    var STEP_EVENT = 'fill';

    function reducedMotion() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // The word settles in instead of jumping; nothing moves for a visitor who asked for less motion.
    function settle(el, calm) {
        if (calm || typeof el.animate !== 'function') {
            return;
        }
        el.animate(
            [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
            { duration: 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
        );
    }

    function initStack() {
        var word = document.getElementById('stackWord');
        var label = document.getElementById('stackLabel');
        var links = document.querySelectorAll('#choices a');
        if (!word || !label || links.length === 0) {
            return;
        }

        var calm = reducedMotion();
        var restWord = word.textContent;
        var restLabel = label.textContent;

        function show(text) {
            var changed = word.textContent !== text;
            word.textContent = text;
            label.textContent = text === restWord ? restLabel : '이 제품으로';
            if (changed) {
                settle(word, calm);
            }
        }

        // the ring of the finder glides to the row that is picked (36px ring: its top is 18px above the centre of the row)
        var choices = document.getElementById('choices');

        Array.prototype.forEach.call(links, function (link) {
            var choose = function () {
                show(link.getAttribute('data-word') || restWord);
                if (choices) {
                    choices.style.setProperty('--ring-y', (link.offsetTop + link.offsetHeight / 2 - 18) + 'px');
                    choices.classList.add('has-ring');
                }
            };
            var leave = function () {
                show(restWord);
                if (choices) {
                    choices.classList.remove('has-ring');
                }
            };
            link.addEventListener('mouseenter', choose);
            link.addEventListener('focus', choose);
            link.addEventListener('mouseleave', leave);
            link.addEventListener('blur', leave);
        });
    }

    function initSteps() {
        var section = document.getElementById('process');
        var list = section ? section.querySelector('.steps') : null;
        var toggle = section ? section.querySelector('.step-toggle') : null;
        if (!list) {
            return;
        }
        var items = list.querySelectorAll('li');
        var views = section.querySelectorAll('.step-view');
        if (items.length === 0 || items.length !== views.length) {
            return;
        }

        var calm = reducedMotion();
        var current = 0;
        var paused = calm;
        var finished = false;
        var visible = typeof IntersectionObserver !== 'function';

        section.classList.add('js-stepper');

        // The centre of a node is 40px below the top of its item; the ball is 14px in a box that starts 4px below the list.
        function ballY(index) {
            return (items[index].offsetTop + 40 - 11) + 'px';
        }

        function show(index) {
            current = index;
            Array.prototype.forEach.call(items, function (item, n) {
                item.classList.toggle('is-active', n === index);
                item.classList.toggle('is-done', n < index);
                item.querySelector('.step-pick').setAttribute('aria-pressed', n === index ? 'true' : 'false');
            });
            Array.prototype.forEach.call(views, function (view, n) {
                view.classList.toggle('is-active', n === index);
            });
            list.style.setProperty('--ball-y', ballY(index));
        }

        function sync() {
            list.classList.toggle('is-running', visible && !finished && !calm);
            list.classList.toggle('is-paused', paused);
            if (toggle) {
                toggle.textContent = finished ? '처음부터 다시 보기' : paused ? '자동 넘김 재생' : '자동 넘김 멈춤';
            }
        }

        function finish() {
            finished = true;
            Array.prototype.forEach.call(items, function (item) {
                item.classList.add('is-done');
            });
            list.style.setProperty('--ball-y', 'calc(100% - 3px)');
            sync();
        }

        Array.prototype.forEach.call(items, function (item, n) {
            item.querySelector('.step-pick').addEventListener('click', function () {
                finished = false;
                show(n);
                sync();
            });
        });

        // the fill of the shown step has run out: the next one, or the end
        list.addEventListener('animationend', function (event) {
            if (event.animationName !== STEP_EVENT || !event.target.classList.contains('step-bar')) {
                return;
            }
            if (current < items.length - 1) {
                show(current + 1);
            } else {
                finish();
            }
        });

        if (toggle) {
            toggle.hidden = calm;
            toggle.addEventListener('click', function () {
                if (finished) {
                    finished = false;
                    paused = false;
                    show(0);
                } else {
                    paused = !paused;
                }
                sync();
            });
        }

        if (!visible) {
            new IntersectionObserver(function (entries) {
                visible = entries[0].isIntersecting;
                sync();
            }, { threshold: 0.5 }).observe(list);
        }

        show(0);
        sync();
    }

    // The three figures count up once, when they come into view. The text of the page is the final number, so
    // without script, without an observer or for a visitor who asked for less motion nothing changes.
    function initFigures() {
        var section = document.querySelector('.figures');
        var nodes = section ? section.querySelectorAll('[data-count]') : [];
        if (nodes.length === 0 || reducedMotion() || typeof IntersectionObserver !== 'function' || typeof requestAnimationFrame !== 'function') {
            return;
        }

        var DURATION = 900;

        function run() {
            var start = null;
            function frame(now) {
                if (start === null) {
                    start = now;
                }
                var t = Math.min(1, (now - start) / DURATION);
                var eased = 1 - Math.pow(1 - t, 3);
                Array.prototype.forEach.call(nodes, function (node) {
                    node.textContent = Math.round(Number(node.getAttribute('data-count')) * eased).toLocaleString('en-US');
                });
                if (t < 1) {
                    requestAnimationFrame(frame);
                }
            }
            requestAnimationFrame(frame);
        }

        var observer = new IntersectionObserver(function (entries) {
            if (!entries[0].isIntersecting) {
                return;
            }
            observer.disconnect();
            run();
        }, { threshold: 0.6 });
        observer.observe(section);
    }

    // Beside the three ways to ask: a sample of each. The tab under the pointer or picked shows its sample, and the
    // way to ask it belongs to is marked.
    function initGuide() {
        var section = document.getElementById('guide');
        var entries = section ? section.querySelectorAll('.guide-list > div') : [];
        var picks = section ? section.querySelectorAll('.guide-pick') : [];
        var views = section ? section.querySelectorAll('.guide-view') : [];
        if (entries.length === 0 || entries.length !== picks.length || entries.length !== views.length) {
            return;
        }

        section.classList.add('js-guide');

        function show(index) {
            Array.prototype.forEach.call(entries, function (entry, n) {
                entry.classList.toggle('is-active', n === index);
            });
            Array.prototype.forEach.call(picks, function (pick, n) {
                pick.setAttribute('aria-pressed', n === index ? 'true' : 'false');
            });
            Array.prototype.forEach.call(views, function (view, n) {
                view.classList.toggle('is-active', n === index);
            });
        }

        Array.prototype.forEach.call(picks, function (pick, n) {
            pick.addEventListener('click', function () { show(n); });
        });
        Array.prototype.forEach.call(entries, function (entry, n) {
            entry.addEventListener('mouseenter', function () { show(n); });
        });

        show(0);
    }

    function init() {
        initStack();
        initSteps();
        initFigures();
        initGuide();
    }

    var api = Object.freeze({ init: init });
    globalThis.BridgePathHome = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();
