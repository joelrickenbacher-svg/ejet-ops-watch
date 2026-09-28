package ch.opswatch.ejet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream

class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Randlos zeichnen, Systemleisten per Padding freihalten
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.bar)) }
        web = WebView(this).apply { setBackgroundColor(getColor(R.color.bg)) }
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }

        val repo = DataRepository(this)
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/web/data/", DataHandler(repo))
            .addPathHandler("/web/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString EJetOpsWatchAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "Android")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.host == HOST) return false
                openExternal(uri)
                return true
            }
        }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        }
        if (web.url == null) {
            web.loadUrl(START + hashFor(intent.getStringExtra(EXTRA_ISSUE)))
        }

        Notifier.ensureChannel(this)
        UpdateWorker.schedule(this)
        maybeAskNotificationPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val id = intent.getStringExtra(EXTRA_ISSUE) ?: return
        web.evaluateJavascript("location.hash = ${JSONObject.quote(hashFor(id))};", null)
    }

    private fun hashFor(issueId: String?): String =
        if (issueId.isNullOrEmpty()) "#/lage" else "#/eintrag/" + Uri.encode(issueId)

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) {
            web.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) { /* kein Browser installiert */ }
    }

    private fun maybeAskNotificationPermission(force: Boolean = false) {
        if (Build.VERSION.SDK_INT < 33) return
        if (Prefs.notifyLevel(this) == "off") return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        if (!force && Prefs.askedPermission(this)) return
        Prefs.setAskedPermission(this)
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    /** Liefert data/issues.json: frisch aus dem Netz, sonst die lokale Kopie (mit Offline-Kennzeichen). */
    private class DataHandler(private val repo: DataRepository) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            if (path != "issues.json") return null
            val fresh = repo.fetchRemote()
            val bytes = fresh ?: repo.readCache() ?: return null
            // Was die App gerade anzeigt, gilt als bekannt – dafür keine Benachrichtigung mehr.
            if (fresh != null) repo.diffAndStore(String(fresh, Charsets.UTF_8))
            val headers = mutableMapOf("Cache-Control" to "no-store")
            if (fresh == null) headers["x-ejw-cache"] = "1"
            return WebResourceResponse("application/json", "utf-8", 200, "OK", headers, ByteArrayInputStream(bytes))
        }
    }

    /** Funktionen, die die Web-Oberfläche über window.Android aufrufen kann. */
    private inner class Bridge {
        @JavascriptInterface
        fun share(title: String, text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .putExtra(Intent.EXTRA_TEXT, text)
            startActivity(Intent.createChooser(send, "Teilen"))
        }

        @JavascriptInterface
        fun getNotifyLevel(): String = Prefs.notifyLevel(this@MainActivity)

        @JavascriptInterface
        fun setNotifyLevel(level: String) {
            Prefs.setNotifyLevel(this@MainActivity, level)
            if (level != "off") runOnUiThread { maybeAskNotificationPermission(force = true) }
        }

        @JavascriptInterface
        fun notificationsAllowed(): Boolean =
            Build.VERSION.SDK_INT < 33 ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun testNotification() = runOnUiThread {
            maybeAskNotificationPermission(force = true)
            Notifier.notify(this@MainActivity, listOf(DataRepository.Change(
                "test", "Test: E-Jet Ops Watch", "watch", false,
                "So sieht eine Benachrichtigung aus, wenn es Neues gibt.")))
        }
    }

    companion object {
        const val EXTRA_ISSUE = "issueId"
        private const val HOST = "appassets.androidplatform.net"
        private const val START = "https://$HOST/web/index.html"
    }
}
