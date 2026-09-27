"""Separación por persona: el modelo se mide con signantes que nunca vio."""
VAL_SIGNERS = {"m03", "g03"}
TEST_SIGNERS = {"m02", "g02"}


def split_of(signer: str) -> str:
    if signer in TEST_SIGNERS:
        return "test"
    if signer in VAL_SIGNERS:
        return "val"
    return "train"
