// The five steps of the process section: one tab selected, one panel shown. Keys of a tab list:
// arrows move between the tabs, Home and End go to the first and the last. Nothing is fetched and no
// text is built here; the panels are in the page.
(function () {
    'use strict';

    function init() {
        var tabs = Array.prototype.slice.call(document.querySelectorAll('.process-tabs [role="tab"]'));
        if (tabs.length === 0) {
            return;
        }

        function select(index, focus) {
            tabs.forEach(function (tab, position) {
                var on = position === index;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.setAttribute('tabindex', on ? '0' : '-1');
                var panel = document.getElementById(tab.getAttribute('aria-controls'));
                if (panel) {
                    panel.hidden = !on;
                }
            });
            if (focus) {
                tabs[index].focus();
            }
        }

        tabs.forEach(function (tab, index) {
            tab.addEventListener('click', function () {
                select(index, false);
            });
            tab.addEventListener('keydown', function (event) {
                var last = tabs.length - 1;
                var target = null;
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                    target = index === last ? 0 : index + 1;
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                    target = index === 0 ? last : index - 1;
                } else if (event.key === 'Home') {
                    target = 0;
                } else if (event.key === 'End') {
                    target = last;
                }
                if (target !== null) {
                    event.preventDefault();
                    select(target, true);
                }
            });
        });
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
