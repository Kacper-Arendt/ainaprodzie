package app.retrofit.auth;

import io.swagger.v3.oas.annotations.media.Schema;

/// The UI language vocabulary. The constants are lowercase on purpose: they are the values stored in
/// `app_user.language` and the i18n locale codes the SPA uses, so no mapping sits between them.
@Schema(description = "UI language of a user.")
enum Language {

	en, pl

}
