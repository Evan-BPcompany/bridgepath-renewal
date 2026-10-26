// The home page: the front panel shows the word of the choice that has the pointer or the keyboard
// focus, and goes back to the neutral word when it leaves. Nothing is fetched and no markup is built;
// the words are put in with textContent.
(function () {
    'use strict';

    function init() {
        var word = document.getElementById('stackWord');
        var label = document.getElementById('stackLabel');
        var links = document.querySelectorAll('#choices a');
        if (!word || !label || links.length === 0) {
            return;
        }

        var restWord = word.textContent;
        var restLabel = label.textContent;

        function show(text) {
            word.textContent = text;
            label.textContent = text === restWord ? restLabel : '이 제품으로';
        }

        Array.prototype.forEach.call(links, function (link) {
            var choose = function () { show(link.getAttribute('data-word') || restWord); };
            var leave = function () { show(restWord); };
            link.addEventListener('mouseenter', choose);
            link.addEventListener('focus', choose);
            link.addEventListener('mouseleave', leave);
            link.addEventListener('blur', leave);
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
