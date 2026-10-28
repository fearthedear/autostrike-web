(function (w, d, s, u) {
  if (w.oaiq) return;
  var q = function () {
    q.q.push(arguments);
  };
  q.q = [];
  w.oaiq = q;

  var js = d.createElement(s);
  js.async = true;
  js.src = u;
  var firstScript = d.getElementsByTagName(s)[0];
  firstScript.parentNode.insertBefore(js, firstScript);
})(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");

window.oaiq("init", {
  pixelId: "3EtzzB2AKP8CpzSGk8KuJt",
  debug: true,
});

window.oaiq("measure", "page_viewed", {
  type: "contents",
  contents: [
    {
      id: window.location.pathname,
      name: document.title,
      content_type: "page",
    },
  ],
});

window.trackAutoStrikeAdsEvent = function (eventName) {
  window.oaiq("measure", "custom", { type: "custom" }, {
    custom_event_name: eventName,
  });
};

document.addEventListener("click", function (event) {
  if (event.defaultPrevented || !event.target || !event.target.closest) return;
  var appStoreLink = event.target.closest(
    'a[href*="apps.apple.com/us/app/autostrike-golf/id6762587973"]'
  );
  if (appStoreLink) window.trackAutoStrikeAdsEvent("app_store_link_clicked");
});
