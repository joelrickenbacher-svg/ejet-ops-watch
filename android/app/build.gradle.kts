plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Wird vom GitHub-Workflow gesetzt (-Pejw.dataUrl=…). Lokal: in gradle.properties eintragen.
val dataUrl = (project.findProperty("ejw.dataUrl") as String?)
    ?: "https://example.github.io/ejet-ops-watch/data/issues.json"
val appVersionCode = (project.findProperty("ejw.versionCode") as String?)?.toIntOrNull() ?: 1
val appVersionName = (project.findProperty("ejw.versionName") as String?) ?: "1.0.$appVersionCode"
val keystorePath: String? = System.getenv("EJW_KEYSTORE")

// Die Web-Oberfläche (index.html, app.js …) wird beim Build aus dem Repository übernommen.
val copyWebApp by tasks.registering(Copy::class) {
    from(rootDir.parentFile) {
        include("index.html", "styles.css", "app.js", "manifest.webmanifest", "icons/**", "data/**")
    }
    into(layout.buildDirectory.dir("generated/webassets"))
}

android {
    namespace = "ch.opswatch.ejet"
    compileSdk = 35

    defaultConfig {
        applicationId = "ch.opswatch.ejet"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "DATA_URL", "\"$dataUrl\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        create("release") {
            if (keystorePath != null && file(keystorePath).exists()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("EJW_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("EJW_KEY_ALIAS") ?: "ejw"
                keyPassword = System.getenv("EJW_KEY_PASSWORD") ?: System.getenv("EJW_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release")
                            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    sourceSets["main"].assets.srcDir(copyWebApp)
}

tasks.named("preBuild") { dependsOn(copyWebApp) }

dependencies {
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime:2.10.0")
}
