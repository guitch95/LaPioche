import Fluent
import FluentSQLiteDriver
import Vapor
import JWT

func configure(_ app: Application) async throws {
    app.http.server.configuration.port = 8081

    // Clé utilisée pour signer et vérifier les tokens JWT
    let jwtSecret: String
    if let secret = Environment.get("JWT_SECRET") {
        jwtSecret = secret
    } else if app.environment == .testing { // clé factice pour les tests
        jwtSecret = "secret-uniquement-pour-les-tests"
    } else {
        fatalError("JWT_SECRET manquant dans le fichier .env")
    }
    await app.jwt.keys.add(hmac: HMACKey(from: jwtSecret), digestAlgorithm: .sha256)



    let cors = CORSMiddleware(configuration: .init(
        allowedOrigin: .all,
        allowedMethods: [.GET, .POST, .PUT, .DELETE, .OPTIONS],
        allowedHeaders: [.accept, .contentType, .origin, .authorization] // authorization --> API autorise l'en-tête Authorization 
    ))
    // CORS must wrap the error middleware so that error responses carry its headers too.
    app.middleware = .init()
    app.middleware.use(cors, at: .beginning)
    app.middleware.use(ErrorMiddleware.default(environment: app.environment))
    app.middleware.use(FileMiddleware(publicDirectory: app.directory.publicDirectory, defaultFile: "index.html"))

    if app.environment == .testing {
        app.databases.use(.sqlite(.memory), as: .sqlite)
    } else {
        app.databases.use(.sqlite(.file("db.sqlite")), as: .sqlite)
    }

    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601

    ContentConfiguration.global.use(encoder: encoder, for: .json)
    ContentConfiguration.global.use(decoder: decoder, for: .json)

    app.migrations.add(CreateGame())
    app.migrations.add(CreateMember())
    app.migrations.add(CreateLoan())
    app.migrations.add(CreateUser())

    try await app.autoMigrate()

    try routes(app)
}
