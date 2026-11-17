/** Initialize Vexor embeds after fetching a viewer-specific, short-lived token. */
(function () {
  "use strict";

  function startPlayer(element) {
    if (element.dataset.vexorState === "loading" || element.dataset.vexorState === "ready") return;
    if (!window.vexorPlayerConfig || !window.VexorPlayer || typeof window.VexorPlayer.createVexorPlayer !== "function") return;

    element.dataset.vexorState = "loading";
    var status = document.createElement("div");
    status.className = "vexor-embed-status";
    status.setAttribute("role", "status");
    status.textContent = window.vexorPlayerConfig.loading;
    element.appendChild(status);

    fetchPlaybackData(element)
      .then(function (data) {
        status.remove();
        element.vexorPlayerInstance = window.VexorPlayer.createVexorPlayer(element, {
          src: data.manifest_url,
          poster: element.dataset.poster || data.thumbnail_url || undefined,
          watermark: data.watermark || undefined,
          protect: element.dataset.protect === "true",
          autoPlay: element.dataset.autoplay === "true",
          muted: element.dataset.muted === "true",
          controls: true,
          refreshToken: function () {
            return fetchPlaybackData(element).then(function (freshData) {
              if (!freshData.token) throw new Error("Vexor did not return a refreshed playback token.");
              return freshData.token;
            });
          },
          onError: function () {
            if (element.vexorPlayerInstance) {
              element.vexorPlayerInstance.destroy();
              element.vexorPlayerInstance = null;
            }
            showFailure(element, window.vexorPlayerConfig.failed);
          },
        });
        element.dataset.vexorState = "ready";
      })
      .catch(function () {
        status.remove();
        showFailure(element, window.vexorPlayerConfig.failed);
      });
  }

  function fetchPlaybackData(element) {
    var body = new URLSearchParams();
    body.set("action", "vexor_playback_token");
    body.set("nonce", window.vexorPlayerConfig.nonce);
    body.set("asset_id", element.dataset.assetId || "");
    body.set("watermark", element.dataset.watermark || "default");

    return fetch(window.vexorPlayerConfig.ajaxUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString(),
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || !payload || !payload.success || !payload.data) {
            throw new Error((payload && payload.data && payload.data.message) || window.vexorPlayerConfig.failed);
          }
          return payload.data;
        });
      });
  }

  function showFailure(element, message) {
    element.dataset.vexorState = "failed";
    element.textContent = "";
    var status = document.createElement("div");
    status.className = "vexor-embed-status vexor-embed-error";
    status.setAttribute("role", "alert");
    status.appendChild(document.createTextNode(message + " "));
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "vexor-embed-retry";
    retry.textContent = window.vexorPlayerConfig.retry;
    retry.addEventListener("click", function () {
      status.remove();
      element.dataset.vexorState = "idle";
      startPlayer(element);
    });
    status.appendChild(retry);
    element.appendChild(status);
  }

  function scan(root) {
    if (root.nodeType === 1 && root.matches(".vexor-player-embed")) startPlayer(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(".vexor-player-embed").forEach(startPlayer);
    }
  }

  function init() {
    scan(document);
    if (window.MutationObserver) {
      var observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          record.addedNodes.forEach(scan);
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
