jQuery(document).ready(function ($) {
  // Test API Connection
  $("#vexor-test-btn").on("click", function (e) {
    e.preventDefault();
    var $btn = $(this);
    var $result = $("#vexor-test-result");

    $btn.prop("disabled", true).text("Testing...");
    $result.html("");

    $.post(
      vexorAdmin.ajax_url,
      {
        action: "vexor_test_connection",
        nonce: vexorAdmin.nonce,
      },
      function (response) {
        $btn.prop("disabled", false).text("Test Connection");
        if (response.success) {
          $result
            .css("color", "#059669")
            .text("✓ " + (response.data.message || "Connected successfully!"));
        } else {
          $result
            .css("color", "#dc2626")
            .text("✕ " + (response.data.message || "Connection failed. Check API Key."));
        }
      }
    ).fail(function () {
      $btn.prop("disabled", false).text("Test Connection");
      $result.css("color", "#dc2626").text("✕ Network request error.");
    });
  });

  // 1-Click Copy Shortcode
  $(".vexor-copy-btn").on("click", function (e) {
    e.preventDefault();
    var text = $(this).data("clipboard");
    var $btn = $(this);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var original = $btn.text();
        $btn.text("Copied!");
        setTimeout(function () {
          $btn.text(original);
        }, 1500);
      });
    }
  });
});
