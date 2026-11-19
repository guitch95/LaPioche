import Fluent
import Vapor

struct MemberController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let members = routes.grouped("members")
        members.get(use: index)
        members.post(use: create)
        members.group(":memberID") { member in
            member.get(use: show)
            member.put(use: updateMember)
            member.delete(use: deleteMember)
        }
        members.get(":memberID", "loans", use: getLoansOfMember)
    }

    @Sendable
    func index(req: Request) async throws -> [MemberDTO] {
        try await Member.query(on: req.db).all().map { $0.toDTO() }
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        try CreateMemberDTO.validate(content: req)
        let dto = try req.content.decode(CreateMemberDTO.self)

        let emailTaken =
            try await Member.query(on: req.db)
            .filter(\.$email == dto.email)
            .count() > 0
        guard !emailTaken else {
            throw Abort(
                .conflict,
                reason: "A member with this email already exists"
            )
        }

        let member = dto.toModel()
        try await member.save(on: req.db)
        return try await member.toDTO().encodeResponse(
            status: .created,
            for: req
        )
    }

    @Sendable
    func show(req: Request) async throws -> MemberDTO {
        guard let memberID = req.parameters.get("memberID", as: UUID.self)
        else {
            throw Abort(.badRequest, reason: "Invalid member id")
        }
        guard let member = try await Member.find(memberID, on: req.db) else {
            throw Abort(.notFound, reason: "Member not found")
        }
        return member.toDTO()
    }


    @Sendable
    func getLoansOfMember(req:Request) async throws -> [LoanDTO] {
        let member = try await findMember(req)
        let loans = try await member.$loans.get(on: req.db)

        return loans.map {$0.toDTO() }

    }

    @Sendable
    func updateMember(req: Request) async throws -> MemberDTO {
        try CreateMemberDTO.validate(content: req)
        let input = try req.content.decode(CreateMemberDTO.self)
        let member = try await findMember(req)

        let emailAlreadyUsed =
            try await Member.query(on: req.db)
            .filter(\.$email == input.email)
            .first() != nil

        if emailAlreadyUsed && member.email != input.email {
            throw Abort(.conflict, reason: "A member with this email already exists")
        }

        member.email = input.email
        member.name = input.name

        try await member.update(on: req.db)
        return member.toDTO()

    }

    @Sendable
    func deleteMember(req: Request) async throws -> HTTPStatus {
        let member = try await findMember(req)
        guard
            try await Loan.query(on: req.db)
                .filter(\.$member.$id == member.requireID())
                .first()
                == nil
                else {
            throw Abort(
                .badRequest,
                reason:
                    "A member with loans cannot be deleted"
            )
        }

        try await member.delete(on: req.db)
        return .noContent

    }

    private func findMember(_ req: Request) async throws -> Member {
        guard let memberID = req.parameters.get("memberID", as: UUID.self)
        else {
            throw Abort(.badRequest, reason: "Invalid member id")
        }
        guard
            let member = try await Member.query(on: req.db)
                .filter(\.$id == memberID)
                .with(\.$loans)
                .first()
        else {
            throw Abort(.notFound, reason: "Member not found")
        }
        return member
    }
}
