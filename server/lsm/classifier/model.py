import torch
from torch import nn

from lsm.features import F_DIM, T_OUT


class SignTransformer(nn.Module):
    def __init__(self, n_classes: int, f_dim: int = F_DIM, t: int = T_OUT, d: int = 128,
                 layers: int = 3, heads: int = 4, ff: int = 256, dropout: float = 0.2):
        super().__init__()
        self.inp = nn.Linear(f_dim, d)
        self.pos = nn.Parameter(torch.zeros(1, t, d))
        layer = nn.TransformerEncoderLayer(d, heads, ff, dropout, batch_first=True, norm_first=True)
        self.enc = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.enc(self.inp(x) + self.pos)
        return self.head(self.norm(h.mean(dim=1)))
