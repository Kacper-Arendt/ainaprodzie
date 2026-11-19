"""LiteLLM's Presidio guardrail, which takes no part of an IBAN for a card number (chat ADR 0017).

Presidio's analyzer finds a card number inside some IBANs: in PL61 1090 1014 0000 0712 1981 2874, the 16 digits after
PL61 start with 1 and pass the Luhn check. LiteLLM, in the version compose.yaml pins, refuses a request for a
CREDIT_CARD finding wherever it lies, although the anonymizer masks the whole IBAN. Here a card number found whole
inside an IBAN is no finding, so the request goes on with <IBAN_CODE>; a card number anywhere else still refuses it.
config.yaml names this class instead of presidio, and test_personal_data_guardrail.py tests the rule.
"""

from litellm.proxy.guardrails.guardrail_hooks.presidio import OPTIONAL_PresidioPIIMasking

# LiteLLM passes the analyzer's findings through this method before it refuses or masks. Under another name the rule
# below would never run and an IBAN would be refused again, so the proxy does not start.
if not hasattr(OPTIONAL_PresidioPIIMasking, "filter_analyze_results_by_score"):
    raise ImportError("LiteLLM's Presidio guardrail has no filter_analyze_results_by_score for PersonalDataGuardrail")


class PersonalDataGuardrail(OPTIONAL_PresidioPIIMasking):
    def filter_analyze_results_by_score(self, analyze_results):
        findings = super().filter_analyze_results_by_score(analyze_results)
        if not isinstance(findings, list):
            return findings
        ibans = [finding for finding in findings if finding.get("entity_type") == "IBAN_CODE"]
        return [finding for finding in findings if not _is_card_number_inside(finding, ibans)]


def _is_card_number_inside(finding, ibans):
    return finding.get("entity_type") == "CREDIT_CARD" and any(
        iban["start"] <= finding["start"] and finding["end"] <= iban["end"] for iban in ibans
    )
