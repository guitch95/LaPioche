import Fluent
import Vapor

final class Loan: Model, @unchecked Sendable {
    static let schema = "loans"
    static let durationInDays = 14

    @ID(key: .id)
    var id: UUID?

    @Parent(key: "game_id")
    var game: Game

    @Parent(key: "member_id")
    var member: Member

    @Field(key: "borrowed_at")
    var borrowedAt: Date

    @Field(key: "due_at")
    var dueAt: Date

    @OptionalField(key: "returned_at")
    var returnedAt: Date?

    init() {}

    init(id: UUID? = nil, gameID: Game.IDValue, memberID: Member.IDValue, borrowedAt: Date, dueAt: Date) {
        self.id = id
        self.$game.id = gameID
        self.$member.id = memberID
        self.borrowedAt = borrowedAt
        self.dueAt = dueAt
    }
}

extension Loan {
    static func dueDate(from start: Date) throws -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let due = calendar.date(byAdding: .day, value: durationInDays, to: start) else {
            throw Abort(.internalServerError, reason: "Could not compute the due date")
        }
        return due
    }
}

extension Game {
//    var isAvailable: Bool {
//        !($loans.value ?? []).contains { $0.returnedAt == nil }
//    }

    // Requires the `loans` relation to be loaded.
    var isAvailable: Bool {
        // 1. Je récupère les emprunts du jeu (ou une liste vide s'ils ne sont pas chargés)
        let emprunts = $loans.value ?? []

        // 2. Je regarde chaque emprunt un par un
        for emprunt in emprunts {
            // 3. S'il n'a pas de date de retour, le jeu est encore sorti
            if emprunt.returnedAt == nil {
                return false   // pas disponible
            }
        }
        // 4. Aucun emprunt en cours trouvé
        return true            // disponible
    }
}
