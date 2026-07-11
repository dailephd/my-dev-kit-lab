// Fixture only — every value below is fake. Gradle Kotlin DSL candidate.
android {
    signingConfigs {
        create("release") {
            storeFile = file("fake-release-keystore.jks")
            storePassword = "FAKE-KEYSTORE-PASSWORD-0000"
            keyAlias = "fake-release-key"
            keyPassword = "FAKE-KEY-PASSWORD-0000"
        }
    }
}
