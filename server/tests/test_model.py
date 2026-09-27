import torch

from lsm.classifier.model import SignTransformer
from lsm.features import F_DIM, T_OUT


def test_forward_shape():
    m = SignTransformer(n_classes=7)
    out = m(torch.randn(3, T_OUT, F_DIM))
    assert out.shape == (3, 7)


def test_can_overfit_tiny_batch():
    torch.manual_seed(0)
    m = SignTransformer(n_classes=4, dropout=0.0)
    x = torch.randn(8, T_OUT, F_DIM)
    y = torch.tensor([0, 1, 2, 3, 0, 1, 2, 3])
    opt = torch.optim.AdamW(m.parameters(), lr=1e-3)
    for _ in range(150):
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(m(x), y)
        loss.backward()
        opt.step()
    assert (m(x).argmax(1) == y).all()
