"""The rule of personal_data_guardrail.py through LiteLLM's own check_pii, with Presidio's two services faked.

Run in the LiteLLM image of compose.yaml by PersonalDataGuardrailClassTests, so a LiteLLM that no longer calls the
overridden method on the path that refuses a request turns the build red. So does one that words its refusal another
way: the app tells the refusal from another 400 by how its message starts (ChatErrors).
"""

import asyncio
import unittest

from litellm.exceptions import BlockedPiiEntityError

from personal_data_guardrail import PersonalDataGuardrail

CARD_NUMBER = "4111 1111 1111 1111"
IBAN_NUMBER = "PL61 1090 1014 0000 0712 1981 2874"
QUESTION = f"Card {CARD_NUMBER} and IBAN {IBAN_NUMBER}"
IBAN_START = QUESTION.index(IBAN_NUMBER)
IBAN_END = IBAN_START + len(IBAN_NUMBER)
IBAN = {"entity_type": "IBAN_CODE", "start": IBAN_START, "end": IBAN_END, "score": 1.0}
# The 16 digits after PL61, which Presidio takes for a card number.
CARD_INSIDE_IBAN = QUESTION.index("1090"), IBAN_END
CARD_BESIDE_IBAN = QUESTION.index(CARD_NUMBER), QUESTION.index(CARD_NUMBER) + len(CARD_NUMBER)


def card(start, end):
    return {"entity_type": "CREDIT_CARD", "start": start, "end": end, "score": 1.0}


class PersonalDataGuardrailTests(unittest.TestCase):
    def check(self, findings):
        guardrail = PersonalDataGuardrail(
            mock_testing=True,
            guardrail_name="personal-data",
            pii_entities_config={"IBAN_CODE": "MASK", "CREDIT_CARD": "BLOCK"},
        )
        anonymized = []

        async def analyze_text(**_):
            return findings

        async def anonymize_text(analyze_results, **_):
            anonymized.append(analyze_results)
            return "masked"

        guardrail.analyze_text = analyze_text
        guardrail.anonymize_text = anonymize_text
        asyncio.run(guardrail.check_pii(QUESTION, output_parse_pii=False, presidio_config=None, request_data={}))
        return anonymized[0]

    def test_a_card_number_inside_an_iban_is_masked_with_the_iban(self):
        self.assertEqual(self.check([IBAN, card(*CARD_INSIDE_IBAN)]), [IBAN])

    def test_a_card_number_that_is_the_whole_iban_is_masked_with_it(self):
        self.assertEqual(self.check([IBAN, card(IBAN_START, IBAN_END)]), [IBAN])

    def test_a_card_number_beside_an_iban_refuses_the_request(self):
        with self.assertRaises(BlockedPiiEntityError):
            self.check([card(*CARD_BESIDE_IBAN), IBAN])

    def test_a_card_number_overlapping_an_iban_in_part_refuses_the_request(self):
        with self.assertRaises(BlockedPiiEntityError):
            self.check([IBAN, card(IBAN_START - 4, IBAN_START + 15)])

    def test_a_card_number_without_an_iban_refuses_the_request(self):
        with self.assertRaises(BlockedPiiEntityError):
            self.check([card(*CARD_BESIDE_IBAN)])

    def test_a_refusal_starts_with_the_words_the_app_reads_it_by(self):
        with self.assertRaises(BlockedPiiEntityError) as refusal:
            self.check([card(*CARD_BESIDE_IBAN)])
        self.assertRegex(str(refusal.exception), "^Blocked entity detected: CREDIT_CARD ")


if __name__ == "__main__":
    unittest.main()
