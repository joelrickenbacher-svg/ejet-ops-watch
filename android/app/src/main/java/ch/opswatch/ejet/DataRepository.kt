package ch.opswatch.ejet

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Lädt data/issues.json vom Web, hält eine lokale Kopie und merkt sich den zuletzt bekannten Stand. */
class DataRepository(private val ctx: Context) {

    data class Change(val id: String, val title: String, val severity: String, val isNew: Boolean, val detail: String)

    private val cacheFile = File(ctx.filesDir, "issues.json")
    private val prefs = ctx.getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)

    /** Holt die aktuellen Daten. Gibt null zurück, wenn offline oder die Antwort ungültig ist. */
    fun fetchRemote(): ByteArray? = try {
        val url = URL(BuildConfig.DATA_URL + "?t=" + System.currentTimeMillis())
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-cache")
        }
        try {
            if (conn.responseCode == 200) {
                val bytes = conn.inputStream.use { it.readBytes() }
                JSONObject(String(bytes, Charsets.UTF_8)) // Gültigkeit prüfen
                synchronized(LOCK) { cacheFile.writeBytes(bytes) }
                bytes
            } else null
        } finally {
            conn.disconnect()
        }
    } catch (e: Exception) {
        null
    }

    /** Letzte lokale Kopie, sonst die mit der App ausgelieferten Startdaten. */
    fun readCache(): ByteArray? = synchronized(LOCK) {
        if (cacheFile.exists()) cacheFile.readBytes()
        else try { ctx.assets.open("data/issues.json").use { it.readBytes() } } catch (e: Exception) { null }
    }

    /**
     * Vergleicht mit dem zuletzt bekannten Stand und speichert den neuen Stand.
     * Gibt die neuen/aktualisierten offenen Einträge zurück, oder null beim allerersten Abgleich.
     */
    fun diffAndStore(json: String): List<Change>? {
        synchronized(LOCK) {
        val issues = (try { JSONObject(json).optJSONArray("issues") } catch (e: Exception) { null }) ?: return null
        val knownRaw = prefs.getString(Prefs.KEY_KNOWN, null)
        val known = if (knownRaw != null) (try { JSONObject(knownRaw) } catch (e: Exception) { null }) else null
        val next = JSONObject()
        val changes = mutableListOf<Change>()
        for (i in 0 until issues.length()) {
            val obj = issues.optJSONObject(i) ?: continue
            val id = obj.optString("id")
            if (id.isEmpty()) continue
            // Nur inhaltliche Änderungen zählen (nicht jede zusätzliche Quelle)
            val snap = JSONObject()
                .put("status", obj.optString("status"))
                .put("severity", obj.optString("severity"))
                .put("latest", obj.optString("latest"))
                .put("summary", obj.optString("summary").hashCode())
            next.put(id, snap)
            if (known == null) continue
            val old = known.optJSONObject(id)
            val status = obj.optString("status")
            if (old == null) {
                if (status != "resolved") changes += Change(id, obj.optString("title"), obj.optString("severity"), true, firstSentence(obj.optString("summary")))
                continue
            }
            val detail = when {
                old.optString("status") != status -> "Status: ${statusLabel(status)}" + obj.optString("latest").let { if (it.isNotEmpty()) " · $it" else "" }
                old.optString("latest") != obj.optString("latest") && obj.optString("latest").isNotEmpty() -> obj.optString("latest")
                old.optString("severity") != obj.optString("severity") -> "Neu eingestuft"
                old.optInt("summary") != obj.optString("summary").hashCode() -> firstSentence(obj.optString("summary"))
                else -> null
            }
            if (detail != null) changes += Change(id, obj.optString("title"), obj.optString("severity"), false, detail)
        }
        prefs.edit().putString(Prefs.KEY_KNOWN, next.toString()).apply()
        return if (known == null) null else changes
        }
    }

    companion object {
        private val LOCK = Any()

        private fun firstSentence(s: String): String =
            s.split(Regex("(?<=[.!?])\\s+")).firstOrNull()?.take(200) ?: ""

        fun statusLabel(s: String) = when (s) {
            "active" -> "akut"
            "proposed" -> "vorgeschlagen (NPRM)"
            "inforce" -> "AD in Kraft"
            "monitoring" -> "wird beobachtet"
            "resolved" -> "behoben"
            else -> s
        }
    }
}

object Prefs {
    const val FILE = "ejw"
    const val KEY_KNOWN = "known2" // v2: Inhalt statt Zeitstempel (alter Stand wird ignoriert)
    private const val KEY_NOTIFY = "notifyLevel"
    private const val KEY_ASKED = "askedPermission"

    /** "all" (Standard), "urgent" (nur Grounding + Einschränkungen) oder "off". */
    fun notifyLevel(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY_NOTIFY, "all") ?: "all"

    fun setNotifyLevel(ctx: Context, level: String) {
        val v = if (level in setOf("urgent", "all", "off")) level else "all"
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY_NOTIFY, v).apply()
    }

    fun askedPermission(ctx: Context): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_ASKED, false)

    fun setAskedPermission(ctx: Context) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY_ASKED, true).apply()
    }
}
