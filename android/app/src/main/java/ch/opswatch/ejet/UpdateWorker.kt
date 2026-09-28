package ch.opswatch.ejet

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Prüft im Hintergrund etwa stündlich auf neue Einträge und Updates und meldet sie. */
class UpdateWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val repo = DataRepository(applicationContext)
        val bytes = repo.fetchRemote() ?: return Result.retry()
        val changes = repo.diffAndStore(String(bytes, Charsets.UTF_8)) ?: return Result.success()
        val level = Prefs.notifyLevel(applicationContext)
        val relevant = when (level) {
            "all" -> changes
            "urgent" -> changes.filter { it.severity == "grounding" || it.severity == "limitation" }
            else -> emptyList()
        }
        if (relevant.isNotEmpty()) Notifier.notify(applicationContext, relevant)
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "ejw-periodic-check"

        fun schedule(ctx: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val req = PeriodicWorkRequest.Builder(UpdateWorker::class.java, 1, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(ctx)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        fun runOnce(ctx: Context) {
            WorkManager.getInstance(ctx).enqueue(OneTimeWorkRequest.Builder(UpdateWorker::class.java).build())
        }
    }
}
