/*
 * Progressive enhancement only. Everything this file does is optional.
 *
 * The page is complete, readable and correctly themed before this script
 * runs — the theme comes from `?theme=` applied by the inline <head> script,
 * and the content is plain HTML. If this file 404s, is blocked by a tenant
 * CSP, or throws on an old mobile WebView, the reader still gets the whole
 * help page. That is the design, not a happy accident: see the `[data-js]`
 * scoping in styles.css.
 *
 * NO teams-js. It is not a dependency of this repo any more (it left with
 * the deleted teams-tab), and the one thing this page would want it for —
 * the theme — already arrives in the URL. Adding ~180 KB of SDK and a
 * postMessage handshake that this repo has measured HANGING FOREVER under a
 * non-Teams parent, in order to learn something the query string already
 * said, is a bad trade for a help page.
 */

(function () {
  "use strict";

  var root = document.documentElement;

  /* ------------------------------------------------------------- themes */

  var THEMES = ["default", "dark", "glass", "contrast"];

  /**
   * The switcher is a PREVIEW control, and deliberately does not persist.
   *
   * Inside Teams the host's theme is the user's actual, chosen theme, so it
   * must win on every load. A sticky override would leave someone reading a
   * dark help page inside a light Teams and reasonably conclude the tab is
   * broken. Session-only means the switcher can exist for reviewing all four
   * themes without ever fighting the host.
   */
  function wireThemeSwitch() {
    var box = document.querySelector("[data-theme-switch]");
    if (!box) return;

    var buttons = box.querySelectorAll("button[data-set-theme]");

    function sync(active) {
      for (var i = 0; i < buttons.length; i++) {
        var name = buttons[i].getAttribute("data-set-theme");
        buttons[i].setAttribute("aria-pressed", name === active ? "true" : "false");
      }
    }

    box.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-set-theme]");
      if (!button) return;
      var name = button.getAttribute("data-set-theme");
      if (THEMES.indexOf(name) === -1) return;
      root.setAttribute("data-theme", name);
      sync(name);
    });

    sync(root.getAttribute("data-theme") || "default");
  }

  /* ------------------------------------------------------------ reveals */

  /**
   * Adds `.is-in` when an element reaches the viewport, which is what starts
   * every animation on the page.
   *
   * Two things are deliberate:
   *
   * `unobserve` after firing — these are entrance animations, and an element
   * that re-plays every time it scrolls back into view is a page that will
   * not sit still while you read it.
   *
   * The no-IntersectionObserver fallback reveals EVERYTHING immediately
   * rather than leaving it hidden. Same rule as the reduced-motion block:
   * the failure mode of an animation system must never be a blank page.
   */
  function wireReveals() {
    var targets = document.querySelectorAll(".reveal, .reveal-group");

    // Stagger index for grouped children, set here rather than in the
    // markup so adding a card does not mean renumbering its siblings.
    var groups = document.querySelectorAll(".reveal-group");
    for (var g = 0; g < groups.length; g++) {
      var kids = groups[g].children;
      for (var k = 0; k < kids.length; k++) {
        kids[k].style.setProperty("--i", String(k));
      }
    }

    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < targets.length; i++) targets[i].classList.add("is-in");
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          entries[i].target.classList.add("is-in");
          observer.unobserve(entries[i].target);
        }
      },
      {
        // A little before the element is fully on screen, so the animation
        // is already underway by the time the reader's eye arrives rather
        // than starting under it.
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.15,
      }
    );

    for (var t = 0; t < targets.length; t++) observer.observe(targets[t]);
  }

  /* --------------------------------------------------------- replay ctrl */

  /**
   * Lets a reader play the journey animation again.
   *
   * The explainers are the point of this page and they run once. Someone who
   * looked away during the six-second sequence should not have to reload the
   * tab — which, inside Teams, means finding the tab's refresh affordance.
   *
   * Reduced motion is honoured by not offering the control at all: replaying
   * an animation that has been flattened to its final frame does nothing, so
   * a button that appears to do nothing would be worse than no button.
   */
  function wireReplay() {
    var reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var buttons = document.querySelectorAll("[data-replay]");
    for (var i = 0; i < buttons.length; i++) {
      if (reduced) {
        buttons[i].hidden = true;
        continue;
      }
      buttons[i].addEventListener("click", function (event) {
        var id = event.currentTarget.getAttribute("data-replay");
        var stage = document.getElementById(id);
        if (!stage) return;
        stage.classList.remove("is-in");
        // Force a reflow so the browser treats the re-added class as a new
        // animation rather than coalescing the remove/add into a no-op.
        void stage.offsetWidth;
        stage.classList.add("is-in");
      });
    }
  }

  /* ---------------------------------------------------------- section nav */

  /** Highlights the nav entry for whichever section is currently in view. */
  function wireSectionNav() {
    var links = document.querySelectorAll("[data-nav] a[href^='#']");
    if (!links.length || !("IntersectionObserver" in window)) return;

    var byId = {};
    var sections = [];
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute("href").slice(1);
      var section = document.getElementById(id);
      if (!section) continue;
      byId[id] = links[i];
      sections.push(section);
    }

    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var link = byId[entries[i].target.id];
          if (!link) continue;
          if (entries[i].isIntersecting) {
            for (var id in byId) byId[id].removeAttribute("aria-current");
            link.setAttribute("aria-current", "true");
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    for (var s = 0; s < sections.length; s++) observer.observe(sections[s]);
  }

  /* ------------------------------------------------------------ copy cmd */

  /**
   * Copy-to-clipboard on the command reference.
   *
   * `navigator.clipboard` is origin- and permission-gated and is genuinely
   * absent in some Teams mobile WebViews, so the button is only added when
   * the API exists. Rendering a copy button that silently fails is worse
   * than rendering none — the user believes they have the command.
   */
  function wireCopy() {
    if (!navigator.clipboard || !window.isSecureContext) return;

    var targets = document.querySelectorAll("[data-copy]");
    for (var i = 0; i < targets.length; i++) {
      (function (host) {
        var text = host.getAttribute("data-copy");
        var button = document.createElement("button");
        button.type = "button";
        button.className = "copy-btn";
        button.setAttribute("aria-label", "Copy " + text);
        button.textContent = "Copy";

        button.addEventListener("click", function () {
          navigator.clipboard.writeText(text).then(
            function () {
              button.textContent = "Copied";
              setTimeout(function () {
                button.textContent = "Copy";
              }, 1600);
            },
            function () {
              // Permission can be refused even where the API exists. Say so
              // rather than showing a success state that did not happen.
              button.textContent = "Press Ctrl+C";
              setTimeout(function () {
                button.textContent = "Copy";
              }, 2400);
            }
          );
        });

        host.appendChild(button);
      })(targets[i]);
    }
  }

  /* ---------------------------------------------------------------- boot */

  function boot() {
    // Each independently, so one throwing cannot take the others down with
    // it. A broken copy button must not cost the reader the animations.
    var steps = [wireThemeSwitch, wireReveals, wireReplay, wireSectionNav, wireCopy];
    for (var i = 0; i < steps.length; i++) {
      try {
        steps[i]();
      } catch (error) {
        if (window.console && console.warn) console.warn("[help]", error);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
