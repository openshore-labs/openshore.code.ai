import Foundation
import Capacitor
import StoreKit

/// The Capacitor bridge for App Store In-App Purchases, built on StoreKit 2.
/// It handles the auto-renewable Personal subscription
/// (product id ai.openshore.oscode.personal.yearly).
///
/// The JS contract lives in app/src/lib/iap.ts; keep the two in lockstep.
///
/// Design note: the client verification (`VerificationResult.verified`) is only
/// a hint. Every method also returns the raw signed JWS representation so the
/// server can verify the transaction independently with Apple. The server is
/// the source of truth for entitlement; the client is a fast path.
///
/// Event: transactionUpdate (renewals and revocations that arrive while the app
/// is open, via Transaction.updates).
@objc(OscodeIapPlugin)
public class OscodeIapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscodeIapPlugin"
    public let jsName = "OscodeIap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlement", returnType: CAPPluginReturnPromise)
    ]

    /// Long-lived listener for renewals and revocations that land while the app
    /// is running. Held so it can be cancelled if the plugin is torn down.
    private var updatesTask: Task<Void, Never>?

    override public func load() {
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                await self.emitTransactionUpdate(result)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // ------------------------------------------------------------- products

    @objc func products(_ call: CAPPluginCall) {
        guard let productIds = call.getArray("productIds") as? [String], !productIds.isEmpty else {
            call.reject("products needs a non-empty productIds array.")
            return
        }
        Task {
            do {
                let storeProducts = try await Product.products(for: productIds)
                let payload: [[String: Any]] = storeProducts.map { product in
                    [
                        "id": product.id,
                        "displayName": product.displayName,
                        "displayPrice": product.displayPrice,
                        "description": product.description
                    ]
                }
                call.resolve(["products": payload])
            } catch {
                call.reject("Could not load products: \(error.localizedDescription)")
            }
        }
    }

    // ------------------------------------------------------------- purchase

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("purchase needs a productId.")
            return
        }
        Task {
            do {
                let storeProducts = try await Product.products(for: [productId])
                guard let product = storeProducts.first else {
                    call.reject("That product is not available from the App Store.")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    // Bind the transaction from either case so it can always be
                    // finished; the server does the authoritative verification.
                    let transaction: Transaction
                    let verified: Bool
                    switch verification {
                    case .verified(let value):
                        transaction = value
                        verified = true
                    case .unverified(let value, _):
                        transaction = value
                        verified = false
                    }
                    await transaction.finish()
                    call.resolve([
                        "state": "purchased",
                        "jws": verification.jwsRepresentation,
                        "productId": transaction.productID,
                        "originalId": String(transaction.originalID),
                        "verified": verified
                    ])
                case .userCancelled:
                    call.resolve(["state": "cancelled"])
                case .pending:
                    call.resolve(["state": "pending"])
                @unknown default:
                    call.resolve(["state": "unknown"])
                }
            } catch {
                call.reject("The purchase did not complete: \(error.localizedDescription)")
            }
        }
    }

    // -------------------------------------------------------------- restore

    /// The Restore Purchases path Apple 3.1.1 requires. Walks the current
    /// entitlements and hands every verified subscription's JWS back to JS.
    @objc func restore(_ call: CAPPluginCall) {
        let filterId = call.getString("productId")
        Task {
            var transactions: [[String: Any]] = []
            for await result in Transaction.currentEntitlements {
                guard case .verified(let transaction) = result else { continue }
                if let filterId, transaction.productID != filterId { continue }
                transactions.append([
                    "jws": result.jwsRepresentation,
                    "productId": transaction.productID,
                    "originalId": String(transaction.originalID)
                ])
            }
            call.resolve(["transactions": transactions])
        }
    }

    // --------------------------------------------------- currentEntitlement

    @objc func currentEntitlement(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("currentEntitlement needs a productId.")
            return
        }
        Task {
            for await result in Transaction.currentEntitlements {
                guard case .verified(let transaction) = result,
                      transaction.productID == productId else { continue }
                var payload: [String: Any] = [
                    "active": true,
                    "jws": result.jwsRepresentation
                ]
                if let expiresAt = transaction.expirationDate {
                    payload["expiresAt"] = Self.iso8601.string(from: expiresAt)
                }
                call.resolve(payload)
                return
            }
            call.resolve(["active": false])
        }
    }

    // ---------------------------------------------------------------- events

    private func emitTransactionUpdate(_ result: VerificationResult<Transaction>) async {
        let transaction: Transaction
        let verified: Bool
        switch result {
        case .verified(let value):
            transaction = value
            verified = true
        case .unverified(let value, _):
            transaction = value
            verified = false
        }
        // Finishing a delivered update keeps it from re-arriving; the server
        // re-checks the JWS regardless.
        await transaction.finish()
        var payload: [String: Any] = [
            "jws": result.jwsRepresentation,
            "productId": transaction.productID,
            "originalId": String(transaction.originalID),
            "revoked": transaction.revocationDate != nil,
            "verified": verified
        ]
        if let expiresAt = transaction.expirationDate {
            payload["expiresAt"] = Self.iso8601.string(from: expiresAt)
        }
        notifyListeners("transactionUpdate", data: payload)
    }

    // ----------------------------------------------------------------- utils

    private static let iso8601: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
