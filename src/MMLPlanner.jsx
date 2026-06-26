import { useState, useEffect } from "react";
import BUNDLED_CACHE from "../cache/storage.json";

// Local replacements for the Claude-artifact-only `window.storage` API.
// Reads first hit the cache bundled at build time (works with no backend at all,
// e.g. on GitHub Pages); writes still go through the dev server when one is running
// (server/index.js), so cached explanations keep accumulating during local generation.
const storage = {
  async get(key) {
    if (Object.prototype.hasOwnProperty.call(BUNDLED_CACHE, key)) {
      return { value: BUNDLED_CACHE[key] };
    }
    try {
      const r = await fetch(`/api/storage/${encodeURIComponent(key)}`);
      return r.json();
    } catch(_) { return null; }
  },
  async set(key, value) {
    try {
      await fetch(`/api/storage/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
    } catch(_) {}
  },
};

// Set only by the GitHub Pages build (no backend available there) to hide the
// API-calling Generate/Redo buttons — everything is already pre-cached anyway.
const STATIC_DEPLOY = import.meta.env.VITE_HIDE_GENERATE === "true";

function useKatex() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.katex) { setReady(true); return; }
    if (!document.getElementById("kt-css")) {
      const l = document.createElement("link");
      l.id = "kt-css"; l.rel = "stylesheet";
      l.href = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
      document.head.appendChild(l); }
    if (!document.getElementById("kt-js")) {
      const s = document.createElement("script");
      s.id = "kt-js";
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";
      s.onload = () => setReady(true);
      document.head.appendChild(s);
    } else {
      const id = setInterval(() => { if (window.katex) { setReady(true); clearInterval(id); }}, 100);
      return () => clearInterval(id); }
  }, []);
  return ready;
}

function Tex({ children, k }) {
  if (!children) return null;
  const text = String(children);
  if (!k || !window.katex) return <span>{text}</span>;
  const re = /\$\$([\s\S]*?)\$\$|\$([\s\S]*?)\$/g;
  const parts = []; let last = 0, key = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const display = m[1] !== undefined;
    const src = display ? m[1] : m[2];
    try {
      const html = window.katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html" });
      parts.push(<span key={key++}
        style={display ? {display:"block",textAlign:"center",margin:"6px 0",overflowX:"auto"} : {}}
        dangerouslySetInnerHTML={{ __html: html }} />);
    } catch { parts.push(<span key={key++}>{`$${src}$`}</span>); }
    last = re.lastIndex; }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <span>{parts}</span>;
}

// $$...$$ blocks are sometimes emitted across multiple lines (e.g. \begin{aligned} ... \end{aligned}
// with real newlines between rows). The renderer below works line-by-line, so collapse any
// multi-line $$...$$ block onto a single line first (LaTeX's own \\ row breaks are preserved).
function normalizeMathBlocks(content) {
  return content.replace(/\$\$[\s\S]*?\$\$/g, m => m.replace(/\s*\n\s*/g, ' '));
}

// Renders AI-generated explanation text — handles ## / ### headers, **bold**, and $LaTeX$
function ExplRenderer({ content, color, k }) {
  if (!content) return null;
  const lines = normalizeMathBlocks(content).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    const fence = t.match(/^```(\w*)/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') { code.push(lines[i]); i++; }
      i++; // skip closing ```
      out.push(
        <pre key={`code-${i}`} style={{ background:"#161b22", border:"1px solid #30363d",
                      borderRadius:8, padding:"14px 16px", overflowX:"auto",
                      fontFamily:"'JetBrains Mono',monospace", fontSize:12,
                      lineHeight:1.65, color:"#c9d1d9", margin:"8px 0 14px",
                      boxShadow:"inset 0 1px 2px rgba(0,0,0,0.3)" }}>
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }
    out.push(renderExplLine(line, i, color, k));
    i++;
  }
  return <div>{out}</div>;
}

function renderExplLine(line, i, color, k) {
  {
    const t = line.trim();
    if (!t) return <div key={i} style={{height:6}} />;
    if (t === '---') {
      return <hr key={i} style={{ border:"none", borderTop:"1px solid #30363d", margin:"20px 0" }} />;
    }
        // Handle ##, ###, #### headers
        const hm = t.match(/^(#{2,4}) (.+)/);
        if (hm) {
          const lvl = hm[1].length;
          return (
            <div key={i} style={{
              fontWeight: 600,
              color: lvl === 2 ? color : lvl === 3 ? "#b6c0cf" : "#8b949e",
              fontSize: lvl === 2 ? 11.5 : 11.5,
              textTransform: lvl === 2 ? "uppercase" : "none",
              letterSpacing: lvl === 2 ? 0.7 : 0,
              marginTop: lvl === 2 ? 18 : 11,
              marginBottom: lvl === 2 ? 7 : 4,
              borderBottom: lvl === 2 ? `1px solid ${color}28` : "none",
              paddingBottom: lvl === 2 ? 6 : 0,
            }}>
              <Tex k={k}>{hm[2]}</Tex>
            </div>
          );
        }
        // Strip orphan ** or *** left by truncation
        const cleaned = t === '**' || t === '***' ? '' : t;
        if (!cleaned) return <div key={i} style={{height:6}} />;
        // Inline **bold** + LaTeX via Tex
        const boldRe = /\*\*([^*]+)\*\*/g;
        const segments = []; let last = 0, bm, bk = 0;
        while ((bm = boldRe.exec(cleaned)) !== null) {
          if (bm.index > last) segments.push(<Tex key={bk++} k={k}>{cleaned.slice(last, bm.index)}</Tex>);
          segments.push(<strong key={bk++} style={{color:"#e6edf3"}}><Tex k={k}>{bm[1]}</Tex></strong>);
          last = boldRe.lastIndex;
        }
    if (last < cleaned.length) segments.push(<Tex key={bk++} k={k}>{cleaned.slice(last)}</Tex>);
    return (
      <div key={i} style={{ lineHeight:1.8, fontSize:12.5, color:"#ccd3dc", marginBottom:3 }}>
        {segments}
      </div>
    );
  }
}

const PLAN = [
  { id:"ch2", num:2, title:"Linear Algebra", color:"#f0a030",
    tagline:"Data as vectors. Transformations as matrices.",
    frRef:"MML §2.9 · pp. 63–64",
    furtherReading:"For more depth, the standard next stops are Strang's Introduction to Linear Algebra, Axler's Linear Algebra Done Right, and Liesen & Mehrmann. We only used Gaussian elimination to solve $A\\mathbf{x}=\\mathbf{b}$, but for large or ill-conditioned systems, numerical linear algebra texts (Golub & Van Loan; Horn & Johnson) cover far more robust algorithms. The next chapter adds the inner product, turning this purely algebraic toolkit into a geometric one — letting us define angles, lengths, and distances, and ultimately the orthogonal projections that power linear regression (Ch 9) and PCA (Ch 10).",
    sections:[
      { id:"2.1", title:"Systems of Linear Equations", pages:"19–22",
        why:"Every ML model reduces to $A\\mathbf{x}=\\mathbf{b}$ \u2014 regression, constrained optimisation, neural net forward pass.",
        py:"## Solving with NumPy\nFor small dense systems, use `np.linalg.solve`, which is more efficient and numerically stable than computing $A^{-1}$ explicitly.\n\n```python\nimport numpy as np\n\nA = np.array([[2,1,-1],[-3,-1,2],[-2,1,2]])\nb = np.array([8,-11,-3])\n\nx = np.linalg.solve(A, b)\nprint(x)  # [2. 3. -1.]\n```\n\nAvoid `np.linalg.inv(A) @ b` -- it's slower and less numerically stable for larger systems.",
        resources:[
          {name:"Strang 18.06 \u2014 Elimination (Lec 2)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-2-elimination-with-matrices/"},
          {name:"Paul's Notes \u2014 Linear Systems", url:"https://tutorial.math.lamar.edu/Classes/Alg/SystemsTwoVrble.aspx"},
        ],
        exs:[
          {q:"Solve the $3\\times 3$ system: $2x+y-z=8$, $-3x-y+2z=-11$, $-2x+y+2z=-3$.",ref:"Strang 18.06, PS1"},
          {q:"Without solving, decide whether $2x+4y=6$, $x+2y=3$ has $0$, $1$, or $\\infty$ solutions. What changes if the second equation is $x+2y=4$? Explain geometrically.",ref:"Original"},
          {q:"Write $3x_1-2x_2+x_3=1$, $x_1+x_3=2$, $-x_1+x_2=0$ in matrix form $A\\mathbf{x}=\\mathbf{b}$. State the shape of $A$.",ref:"Original"},
          {q:"The augmented matrix $\\begin{pmatrix}1&3&-2&0\\\\2&6&-5&-2\\\\0&0&5&10\\end{pmatrix}$ is in row echelon form. Use back-substitution to find all solutions.",ref:"Adapted from Strang 18.06, PS1"},
          {q:"Prove a linear system $A\\mathbf{x}=\\mathbf{b}$ must have $0$, $1$, or $\\infty$ solutions \u2014 never exactly $2$. (Hint: if $\\mathbf{x}_1$ and $\\mathbf{x}_2$ are two distinct solutions, what is $\\mathbf{x}_1+t(\\mathbf{x}_2-\\mathbf{x}_1)$ for $t\\in\\mathbb{R}$?)",ref:"Original"},
        ]},
      { id:"2.2", title:"Matrices", pages:"22–27",
        why:"Every linear transformation \u2014 weight matrix, covariance matrix, attention head \u2014 is a matrix.",
        py:"## Matrix Operations with NumPy\nNumPy arrays support matrix multiplication via `@` (or `np.matmul`), elementwise ops via `*`, and `.T` for transpose.\n\n```python\nimport numpy as np\n\nA = np.array([[1,2],[3,4]])\nB = np.array([[0,1],[1,0]])\n\nprint(A @ B)      # matrix product\nprint(A * B)      # elementwise (Hadamard) product\nprint(A.T)        # transpose\nprint(A.T @ A)    # symmetric Gram matrix\n```\n\n**Watch out:** `*` is elementwise, not matrix multiplication -- a common source of silent bugs when porting math to code.",
        resources:[
          {name:"3Blue1Brown \u2014 Linear Transformations", url:"https://www.youtube.com/watch?v=kYB8IZa5AuE"},
          {name:"Khan Academy \u2014 Matrix multiplication", url:"https://www.khanacademy.org/math/linear-algebra/matrix-transformations/composition-of-transformations/v/linear-algebra-matrix-product-examples"},
        ],
        exs:[
          {q:"Let $A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$, $B=\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix}$. Compute $AB$ and $BA$. Does $AB=BA$?",ref:"Original"},
          {q:"For $A=\\begin{pmatrix}2&1\\\\-1&3\\end{pmatrix}$, compute $A^TA$. Is the result symmetric? (This type of matrix appears in least-squares regression.)",ref:"Original"},
          {q:"Prove $(AB)^T=B^TA^T$ for any compatible matrices $A$ and $B$.",ref:"Strang 18.06, PS2"},
          {q:"Compute $A^2$ and $A^3$ for $A=\\begin{pmatrix}1&1\\\\0&1\\end{pmatrix}$, identify the pattern, and write a formula for $A^n$.",ref:"Strang 18.06, PS2"},
          {q:"If $A$ is $m\\times n$ with $m<n$, can $A\\mathbf{x}=\\mathbf{b}$ have a unique solution for every $\\mathbf{b}$? What about $m>n$? Justify.",ref:"Original"},
        ]},
      { id:"2.3", title:"Solving Systems of Linear Equations", pages:"27–35",
        why:"Gaussian elimination underpins matrix inverses, least-squares, and numerical linear algebra.",
        py:"## Row Reduction and the General Solution\nNumPy has no built-in RREF (it favors direct solves), but `sympy` reproduces the by-hand elimination from this section, and `scipy.linalg.null_space` gives a basis for the homogeneous solution space.\n\n```python\nimport numpy as np\nfrom scipy.linalg import null_space\nimport sympy as sp\n\nA = sp.Matrix([[1,2,-1],[2,4,1],[0,1,3]])\nrref, pivots = A.rref()\nprint(rref)        # row-reduced echelon form\nprint(pivots)      # pivot columns\n\n# Null space (homogeneous solutions) for a non-square A\nA2 = np.array([[1,2,0,-1],[1,2,1,0],[2,4,1,-1]])\nprint(null_space(A2))\n```",
        resources:[
          {name:"Strang 18.06 \u2014 Elimination continued (Lec 3)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-3-multiplication-and-inverse-matrices/"},
          {name:"Paul's Notes \u2014 RREF", url:"https://tutorial.math.lamar.edu/Classes/Alg/AugmentedMatrix.aspx"},
        ],
        exs:[
          {q:"Reduce $[A|\\mathbf{b}]$ to RREF for $A=\\begin{pmatrix}1&2&-1\\\\2&4&1\\\\0&1&3\\end{pmatrix}$, $\\mathbf{b}=(5,7,3)^T$. Identify pivot columns and state the unique solution.",ref:"Original"},
          {q:"Find the complete general solution (particular $+$ null-space part) of $x_1+2x_2-x_3=3$, $2x_1+x_2+x_3=6$.",ref:"Original"},
          {q:"Find $A^{-1}$ for $A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$ using Gauss-Jordan elimination.",ref:"Strang 18.06, PS1"},
          {q:"For what value(s) of $c$ does $x+2y=3$, $2x+4y=c$ have (a) no solution, (b) $\\infty$ solutions? Can it have a unique solution?",ref:"Strang 18.06, PS1"},
          {q:"Find all solutions to $A\\mathbf{x}=\\mathbf{0}$ for $A=\\begin{pmatrix}1&2&0&-1\\\\1&2&1&0\\\\2&4&1&-1\\end{pmatrix}$. Express the solution space as a linear combination of basis vectors.",ref:"Adapted from Strang 18.06, PS2"},
        ]},
      { id:"2.4", title:"Vector Spaces", pages:"35–40",
        why:"ML embedding spaces are vector spaces; understanding closure shapes how we design features and measure similarity.",
        py:"## Checking Subspace Membership Numerically\nThere's no single function that \"checks\" a subspace, but you can test whether a vector lies in $\\text{span}\\{\\mathbf{v}_1,\\dots,\\mathbf{v}_k\\}$ by solving a least-squares problem and checking the residual.\n\n```python\nimport numpy as np\n\nV = np.array([[1,0],[0,1],[1,1]]).T  # columns span a subspace of R^3\nx = np.array([2,3,5])\n\nc, *_ = np.linalg.lstsq(V, x, rcond=None)\nin_span = np.allclose(V @ c, x)\nprint(in_span)  # True: x = 2*v1 + 3*v2\n```",
        resources:[
          {name:"Strang 18.06 \u2014 Vector Spaces (Lec 5)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-5-transposes-permutations-spaces-r-n/"},
          {name:"Axler LADR \u2014 Chapter 1 (free PDF)", url:"https://linear.axler.net/"},
        ],
        exs:[
          {q:"Is $V=\\{(x,y)\\in\\mathbb{R}^2:x\\geq 0\\}$ a subspace of $\\mathbb{R}^2$? Check all three conditions: zero vector, closure under $+$, closure under scalar multiplication.",ref:"Original"},
          {q:"Is $W=\\{(x,y,z):x+2y-z=0\\}$ a subspace of $\\mathbb{R}^3$? Is $W'=\\{(x,y,z):x+2y-z=1\\}$? Why not both?",ref:"Original"},
          {q:"Prove $\\text{null}(A)=\\{\\mathbf{x}:A\\mathbf{x}=\\mathbf{0}\\}$ is a vector subspace of $\\mathbb{R}^n$ for any $A\\in\\mathbb{R}^{m\\times n}$.",ref:"Strang 18.06, PS2"},
          {q:"Is the set of polynomials of degree exactly 2 (not 'at most 2') a subspace of all polynomials? Justify.",ref:"Axler LADR \u00a71.B"},
          {q:"Prove $V\\cap W$ of two subspaces $V,W\\subseteq\\mathbb{R}^n$ is always a subspace. Is their union $V\\cup W$ always a subspace? Give a counterexample if not.",ref:"Axler LADR \u00a71.B"},
        ]},
      { id:"2.5", title:"Linear Independence", pages:"40–44",
        why:"Redundant features are linearly dependent \u2014 detecting this prevents degenerate models and informs feature selection.",
        py:"## Testing Independence with Rank\nA set of vectors is linearly independent iff the matrix formed by stacking them as columns has full column rank -- check with `np.linalg.matrix_rank`.\n\n```python\nimport numpy as np\n\nV = np.array([[1,4,7],[2,5,8],[3,6,9]]).T  # v1, v2, v3 as columns\n\nrank = np.linalg.matrix_rank(V)\nprint(rank, V.shape[1])  # 2 3 -> dependent (rank < #vectors)\n```\n\n`matrix_rank` is more numerically robust than computing a determinant, especially for non-square or near-singular matrices.",
        resources:[
          {name:"Strang 18.06 \u2014 Independence, Basis & Dimension (Lec 9)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-9-independence-basis-and-dimension/"},
          {name:"Khan Academy \u2014 Introduction to linear independence", url:"https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces/linear-independence/v/linear-algebra-introduction-to-linear-independence"},
          {name:"Khan Academy \u2014 More on linear independence", url:"https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces/linear-independence/v/more-on-linear-independence"},
          {name:"Khan Academy \u2014 Span and linear independence example", url:"https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces/linear-independence/v/span-and-linear-independence-example"},
        ],
        exs:[
          {q:"Are $\\mathbf{v}_1=(1,2,3)^T$, $\\mathbf{v}_2=(4,5,6)^T$, $\\mathbf{v}_3=(7,8,9)^T$ linearly independent? Set up and solve $c_1\\mathbf{v}_1+c_2\\mathbf{v}_2+c_3\\mathbf{v}_3=\\mathbf{0}$.",ref:"Original"},
          {q:"Can 4 vectors in $\\mathbb{R}^3$ ever be linearly independent? Explain using the rank-nullity theorem.",ref:"Original"},
          {q:"Show $\\{\\sin x,\\cos x\\}$ is linearly independent. (Hint: set $c_1\\sin x+c_2\\cos x=0$ for all $x$, evaluate at $x=0$ and $x=\\pi/2$.)",ref:"Axler LADR \u00a72.A"},
          {q:"If $\\{\\mathbf{v}_1,\\mathbf{v}_2,\\mathbf{v}_3\\}$ is linearly independent and $\\mathbf{v}_4\\in\\text{span}\\{\\mathbf{v}_1,\\mathbf{v}_2,\\mathbf{v}_3\\}$, show $\\{\\mathbf{v}_1,\\mathbf{v}_2,\\mathbf{v}_3,\\mathbf{v}_4\\}$ is linearly dependent.",ref:"Axler LADR \u00a72.A"},
          {q:"Let $A\\in\\mathbb{R}^{m\\times n}$ with $m<n$. Show the columns of $A$ must be linearly dependent. What does this imply for data matrices with more features than samples?",ref:"Original"},
        ]},
      { id:"2.6", title:"Basis and Rank", pages:"44–48",
        why:"The rank of a data matrix equals its true dimensionality \u2014 the foundation of PCA and dimensionality reduction.",
        py:"## Rank, Column Space, and Null Space\n`np.linalg.matrix_rank` gives $\\text{rank}(A)$ directly, while `scipy.linalg.null_space` returns an orthonormal basis for $\\text{null}(A)$ -- together they let you verify the rank-nullity theorem numerically.\n\n```python\nimport numpy as np\nfrom scipy.linalg import null_space\n\nA = np.array([[1,2,3],[2,4,6],[1,3,4]])\n\nr = np.linalg.matrix_rank(A)\nns = null_space(A)\nprint(r, ns.shape[1], A.shape[1])  # rank + nullity == n columns\n```\n\nFor a basis of the column space, use a QR decomposition (`np.linalg.qr(A)`) or take the pivot columns from `sympy`'s `.rref()`.",
        resources:[
          {name:"Strang 18.06 \u2014 Independence, Basis & Dimension (Lec 9)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-9-independence-basis-and-dimension/"},
          {name:"Strang 18.06 \u2014 Four Fundamental Subspaces (Lec 10)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-10-the-four-fundamental-subspaces/"},
        ],
        exs:[
          {q:"Find a basis for the column space and null space of $A=\\begin{pmatrix}1&2&3\\\\2&4&6\\\\1&3&4\\end{pmatrix}$. State $\\text{rank}(A)$ and verify the rank-nullity theorem.",ref:"Strang 18.06, PS3"},
          {q:"Find a basis for $\\mathbb{R}^3$ that contains the vector $(1,1,1)^T$. Show it spans $\\mathbb{R}^3$ and is linearly independent.",ref:"Original"},
          {q:"What is $\\text{rank}(\\mathbf{u}\\mathbf{v}^T)$ for non-zero $\\mathbf{u}\\in\\mathbb{R}^m$, $\\mathbf{v}\\in\\mathbb{R}^n$? Prove your answer.",ref:"Original"},
          {q:"If $A\\in\\mathbb{R}^{m\\times n}$ has $\\text{rank}(A)=r$, state the dimensions of all four fundamental subspaces: $\\text{col}(A)$, $\\text{null}(A)$, $\\text{col}(A^T)$, $\\text{null}(A^T)$.",ref:"Strang 18.06, PS3"},
          {q:"Prove: if $A$ has linearly independent columns, then $A^TA$ is invertible. (Hint: suppose $A^TA\\mathbf{x}=\\mathbf{0}$ and consider $\\mathbf{x}^TA^TA\\mathbf{x}$.)",ref:"Strang 18.06, PS4"},
        ]},
      { id:"2.7", title:"Linear Mappings", pages:"48–61",
        why:"Neural net layers are linear maps ($W\\mathbf{x}$). Change of basis = switching coordinate systems \u2014 key for PCA.",
        py:"## Kernel, Image, and Change of Basis\nThe kernel and image of a linear map $T$ come straight from its matrix: `null_space` for $\\ker(T)$, `matrix_rank` for $\\dim(\\text{Im}(T))$. A change-of-basis matrix is just the matrix whose columns are the new basis vectors.\n\n```python\nimport numpy as np\nfrom scipy.linalg import null_space\n\nT = np.array([[1,1],[2,-1],[1,0]])  # R^2 -> R^3\n\nker = null_space(T)                  # basis for ker(T)\nrank = np.linalg.matrix_rank(T)      # dim(Im(T))\nprint(ker.shape[1], rank, T.shape[1])  # rank-nullity: 0 + 2 = 2\n\n# Express x = (3,1) in basis B' = {(1,1), (1,-1)}\nBprime = np.array([[1,1],[1,-1]]).T\nx = np.array([3,1])\ncoords = np.linalg.solve(Bprime, x)\nprint(coords)  # [2. 1.]\n```",
        resources:[
          {name:"3Blue1Brown \u2014 Linear Transformations (essential)", url:"https://www.youtube.com/watch?v=kYB8IZa5AuE"},
          {name:"Strang 18.06 \u2014 Four Fundamental Subspaces (Lec 10)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-10-the-four-fundamental-subspaces/"},
        ],
        exs:[
          {q:"For $T:\\mathbb{R}^2\\to\\mathbb{R}^3$, $T(x_1,x_2)=(x_1+x_2,\\ 2x_1-x_2,\\ x_1)$, write the transformation matrix, find $\\ker(T)$ and $\\text{Im}(T)$, and verify rank-nullity.",ref:"Original"},
          {q:"For $A=\\begin{pmatrix}1&0&-1\\\\2&1&1\\end{pmatrix}$, find bases for $\\ker(A)$ and $\\text{Im}(A)$ and state their dimensions.",ref:"Original"},
          {q:"Find the change-of-basis matrix from $B=\\{(1,0)^T,(0,1)^T\\}$ to $B'=\\{(1,1)^T,(1,-1)^T\\}$ in $\\mathbb{R}^2$. Express $\\mathbf{x}=(3,1)^T$ in the $B'$ basis.",ref:"MML \u00a72.7.2"},
          {q:"Show $\\Phi:\\mathbb{R}^n\\to\\mathbb{R}^m$ is injective if and only if $\\ker(\\Phi)=\\{\\mathbf{0}\\}$.",ref:"MML \u00a72.7.3"},
          {q:"For $A=\\begin{pmatrix}1&2&0&1\\\\0&1&1&0\\\\1&3&1&1\\end{pmatrix}$, find $\\dim(\\ker(A))$ and $\\dim(\\text{Im}(A))$ and verify rank-nullity.",ref:"Adapted from Strang 18.06, PS3"},
        ]},
      { id:"2.8", title:"Affine Spaces", pages:"61–63",
        why:"Every ML layer is affine ($W\\mathbf{x}+\\mathbf{b}$). Decision boundaries in SVMs and logistic regression are affine hyperplanes.",
        py:"## Affine Maps as Matrix + Offset\nAn affine map $\\mathbf{x}\\mapsto W\\mathbf{x}+\\mathbf{b}$ is exactly a `Linear`/`Dense` layer in any deep learning framework -- a matrix-vector product plus a broadcast addition.\n\n```python\nimport numpy as np\n\nx0 = np.array([1,0,2])                 # support point\ndirs = np.array([[1,1,0],[0,1,1]]).T   # direction vectors b1, b2\n\n# Parametric point on the affine plane: x0 + t1*b1 + t2*b2\nt = np.array([0.5, -1.0])\npoint = x0 + dirs @ t\nprint(point)\n```\n\nAffine subspaces (solution sets of $A\\mathbf{x}=\\mathbf{b}$) are a particular solution plus the null space, computed via `scipy.linalg.null_space` as in section 2.6.",
        resources:[
          {name:"MML book \u00a72.8 (self-contained, 3 pages)", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"Write the parametric equation of the plane in $\\mathbb{R}^3$ through $\\mathbf{x}_0=(1,0,2)^T$ with direction vectors $\\mathbf{b}_1=(1,1,0)^T$ and $\\mathbf{b}_2=(0,1,1)^T$.",ref:"MML \u00a72.8"},
          {q:"The solution set of $2x_1+x_2-3x_3=6$ is an affine subspace of $\\mathbb{R}^3$. Find a support point and a basis for the direction space.",ref:"Original"},
          {q:"Is the unit circle $\\{\\mathbf{x}\\in\\mathbb{R}^2:\\|\\mathbf{x}\\|_2=1\\}$ an affine subspace? Why or why not?",ref:"Original"},
          {q:"Show any solution to $A\\mathbf{x}=\\mathbf{b}$ ($\\mathbf{b}\\neq\\mathbf{0}$) can be written as $\\mathbf{x}_p+\\mathbf{x}_h$ where $A\\mathbf{x}_p=\\mathbf{b}$ and $\\mathbf{x}_h\\in\\text{null}(A)$. How does this relate to affine spaces?",ref:"Strang 18.06, PS2"},
          {q:"Prove: in $L=\\mathbf{x}_0+U$, the direction space $U$ is uniquely determined by $L$ regardless of the choice of support point $\\mathbf{x}_0\\in L$.",ref:"MML \u00a72.8"},
        ]},
    ]},
  { id:"ch3", num:3, title:"Analytic Geometry", color:"#4ade80",
    tagline:"Distances, angles, and projections inside vector spaces.",
    frRef:"MML §3.10 · pp. 94–96",
    furtherReading:"Axler and Boyd & Vandenberghe are good places to go deeper. The Gram-Schmidt process for building orthogonal/orthonormal bases reappears throughout numerical linear algebra (e.g. Krylov subspace methods like conjugate gradient and GMRES). Inner products are also the foundation of kernel methods (Schölkopf & Smola) — the 'kernel trick' computes inner products implicitly in a high- (even infinite-) dimensional feature space without ever forming it explicitly, which is exactly what makes kernelized SVMs (Ch 12) and Gaussian processes work. Orthogonal projections, meanwhile, are the geometric heart of least-squares linear regression (Ch 9) and PCA (Ch 10) — both covered later in this book.",
    sections:[
      { id:"3.1", title:"Norms", pages:"71–72",
        why:"$L^1$/$L^2$ regularisation and loss functions are norms. Choosing a norm = choosing how to penalise model complexity.",
        py:"## Computing Norms\nNumPy's `np.linalg.norm` computes any $L^p$ norm via the `ord` argument -- this is exactly the regularization penalty in ridge ($L^2$) and lasso ($L^1$) regression.\n\n```python\nimport numpy as np\n\nx = np.array([3.0, -4.0, 1.0])\n\nprint(np.linalg.norm(x, ord=2))   # Euclidean norm: 5.099...\nprint(np.linalg.norm(x, ord=1))   # Manhattan norm: 8.0\nprint(np.linalg.norm(x, ord=np.inf))  # max norm: 4.0\n```\n\nIn a loss function, `lambda * np.linalg.norm(w, ord=1)` is the lasso penalty; `lambda * np.linalg.norm(w)**2` is the ridge penalty.",
        resources:[
          {name:"Khan Academy \u2014 Vector dot product and length", url:"https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces/dot-cross-products/v/vector-dot-product-and-vector-length"},
        ],
        exs:[
          {q:"Compute the $L^1$, $L^2$, and $L^\\infty$ norms of $\\mathbf{v}=(3,-4,0,2)^T$.",ref:"Original"},
          {q:"For $\\mathbf{x}=(1,0)^T$ and $\\mathbf{y}=(0,1)^T$, verify the triangle inequality $\\|\\mathbf{x}+\\mathbf{y}\\|_2\\leq\\|\\mathbf{x}\\|_2+\\|\\mathbf{y}\\|_2$.",ref:"Original"},
          {q:"Prove $\\|\\alpha\\mathbf{v}\\|_2=|\\alpha|\\cdot\\|\\mathbf{v}\\|_2$ for any scalar $\\alpha$ and vector $\\mathbf{v}$.",ref:"Original"},
          {q:"For $\\mathbf{x}=(3,4)^T$, compute $\\|\\mathbf{x}\\|_1$, $\\|\\mathbf{x}\\|_2$, $\\|\\mathbf{x}\\|_\\infty$. Verify $\\|\\mathbf{x}\\|_\\infty\\leq\\|\\mathbf{x}\\|_2\\leq\\|\\mathbf{x}\\|_1$.",ref:"Original"},
          {q:"Show $\\|\\mathbf{x}\\|_1\\leq\\sqrt{n}\\,\\|\\mathbf{x}\\|_2$ for $\\mathbf{x}\\in\\mathbb{R}^n$ using Cauchy-Schwarz. This bounds $L^1$ by $L^2$ regularisation.",ref:"Original"},
        ]},
      { id:"3.2", title:"Inner Products", pages:"72–75",
        why:"Dot products measure similarity. Attention in transformers computes $\\mathbf{q}^T\\mathbf{k}/\\sqrt{d}$ \u2014 a scaled inner product.",
        py:"## Inner Products and the Gram Matrix\nThe standard dot product is `np.dot` or `@`. For a *generalized* inner product $\\langle\\mathbf{x},\\mathbf{y}\\rangle=\\mathbf{x}^TA\\mathbf{y}$ with symmetric positive-definite $A$, just sandwich $A$ in between.\n\n```python\nimport numpy as np\n\nx = np.array([1.0, 2.0])\ny = np.array([3.0, -1.0])\n\nprint(np.dot(x, y))          # standard inner product: 1.0\n\nA = np.array([[2,0],[0,1]])  # SPD matrix defines a new inner product\nprint(x @ A @ y)             # generalized inner product: 4.0\n```\n\nA matrix of pairwise inner products $\\langle\\mathbf{x}_i,\\mathbf{x}_j\\rangle$ is a **Gram matrix** -- compute it for a data matrix $X$ (rows = samples) with `X @ X.T`.",
        resources:[
          {name:"Strang 18.06 \u2014 Orthogonality (Lec 14)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-14-orthogonal-vectors-and-subspaces/"},
          {name:"Khan Academy \u2014 Proving dot product properties", url:"https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces/dot-cross-products/v/proving-vector-dot-product-properties"},
        ],
        exs:[
          {q:"Compute $\\langle\\mathbf{u},\\mathbf{v}\\rangle$ for $\\mathbf{u}=(1,2,3)^T$ and $\\mathbf{v}=(-1,0,2)^T$. Find the angle between them.",ref:"Original"},
          {q:"Verify the standard dot product on $\\mathbb{R}^n$ satisfies all four inner product axioms: symmetry, linearity, positive-definiteness, definiteness.",ref:"Original"},
          {q:"Show $\\langle f,g\\rangle=\\int_0^1 f(x)g(x)\\,dx$ is an inner product on $C[0,1]$. Check linearity and positive-definiteness.",ref:"Axler LADR \u00a76.A"},
          {q:"Prove Cauchy-Schwarz: $|\\langle\\mathbf{u},\\mathbf{v}\\rangle|^2\\leq\\langle\\mathbf{u},\\mathbf{u}\\rangle\\cdot\\langle\\mathbf{v},\\mathbf{v}\\rangle$. (Hint: consider $\\langle\\mathbf{u}-t\\mathbf{v},\\mathbf{u}-t\\mathbf{v}\\rangle\\geq 0$ as a quadratic in $t$.)",ref:"Axler LADR \u00a76.A"},
          {q:"For the weighted inner product $\\langle\\mathbf{x},\\mathbf{y}\\rangle_A=\\mathbf{x}^TA\\mathbf{y}$ with $A=\\begin{pmatrix}2&0\\\\0&1\\end{pmatrix}$, compute $\\|\\mathbf{u}\\|_A$ for $\\mathbf{u}=(1,2)^T$. How does this relate to the Mahalanobis distance?",ref:"MML \u00a73.2"},
        ]},
      { id:"3.3", title:"Lengths and Distances", pages:"75–76",
        why:"Distance metrics define 'similarity' in $k$-NN, clustering, and kernel methods.",
        py:"## Lengths and Distances\nLength is just the norm of a vector; distance between two points is the norm of their difference. `scipy.spatial.distance` provides many distance metrics directly.\n\n```python\nimport numpy as np\nfrom scipy.spatial.distance import euclidean, cityblock\n\nx = np.array([1.0, 2.0])\ny = np.array([4.0, 6.0])\n\nlength_x = np.linalg.norm(x)        # ||x||\ndist = np.linalg.norm(x - y)        # ||x - y||\nprint(length_x, dist)\n\nprint(euclidean(x, y))   # same as dist\nprint(cityblock(x, y))   # L1 (Manhattan) distance\n```",
        resources:[
          {name:"Khan Academy \u2014 Distance formula", url:"https://www.khanacademy.org/math/geometry/hs-geo-analytic-geometry/hs-geo-distance-and-midpoints/v/distance-formula"},
        ],
        exs:[
          {q:"Compute the Euclidean distance between $\\mathbf{x}=(2,-1,3)^T$ and $\\mathbf{y}=(0,1,1)^T$.",ref:"Original"},
          {q:"Show $d(\\mathbf{x},\\mathbf{y})=\\|\\mathbf{x}-\\mathbf{y}\\|_2$ satisfies all metric axioms: non-negativity, symmetry, triangle inequality.",ref:"Original"},
          {q:"Compute the $L^2$ distance between $f(x)=x$ and $g(x)=x^2$ on $[0,1]$ via $d(f,g)=\\sqrt{\\int_0^1(f-g)^2\\,dx}$.",ref:"Original"},
          {q:"The Mahalanobis distance is $d_M(\\mathbf{x},\\boldsymbol{\\mu})=\\sqrt{(\\mathbf{x}-\\boldsymbol{\\mu})^T\\Sigma^{-1}(\\mathbf{x}-\\boldsymbol{\\mu})}$. For $\\boldsymbol{\\mu}=\\mathbf{0}$ and $\\Sigma=\\begin{pmatrix}4&0\\\\0&1\\end{pmatrix}$, compute $d_M((2,1)^T,\\mathbf{0})$ and compare to the Euclidean distance.",ref:"MML \u00a73.3"},
          {q:"Prove the parallelogram law: $\\|\\mathbf{x}+\\mathbf{y}\\|^2+\\|\\mathbf{x}-\\mathbf{y}\\|^2=2(\\|\\mathbf{x}\\|^2+\\|\\mathbf{y}\\|^2)$.",ref:"Axler LADR \u00a76.A"},
        ]},
      { id:"3.4", title:"Angles and Orthogonality", pages:"76–78",
        why:"Cosine similarity (NLP, search) is $\\cos\\theta=\\langle\\mathbf{x},\\mathbf{y}\\rangle/(\\|\\mathbf{x}\\|\\|\\mathbf{y}\\|)$. Orthogonal features are uncorrelated.",
        py:"## Angles and Orthogonality\nThe angle between vectors follows directly from the inner-product definition $\\cos\\omega=\\frac{\\langle\\mathbf{x},\\mathbf{y}\\rangle}{\\|\\mathbf{x}\\|\\|\\mathbf{y}\\|}$, and orthogonality is just $\\langle\\mathbf{x},\\mathbf{y}\\rangle=0$.\n\n```python\nimport numpy as np\n\nx = np.array([1.0, 0.0])\ny = np.array([1.0, 1.0])\n\ncos_omega = (x @ y) / (np.linalg.norm(x) * np.linalg.norm(y))\nomega = np.arccos(cos_omega)\nprint(np.degrees(omega))  # 45.0\n\n# Orthogonality check\nu, v = np.array([1,0]), np.array([0,1])\nprint(np.isclose(u @ v, 0))  # True\n```",
        resources:[
          {name:"Khan Academy \u2014 Defining the angle between vectors", url:"https://www.khanacademy.org/math/linear-algebra/vectors-and-spaces/dot-cross-products/v/defining-the-angle-between-vectors"},
        ],
        exs:[
          {q:"Find the angle between $\\mathbf{u}=(1,1,0)^T$ and $\\mathbf{v}=(0,1,1)^T$. Are they orthogonal?",ref:"Original"},
          {q:"Find all vectors in $\\mathbb{R}^3$ orthogonal to both $\\mathbf{u}=(1,0,1)^T$ and $\\mathbf{v}=(0,1,1)^T$.",ref:"Original"},
          {q:"Compute the cosine similarity between $\\mathbf{x}=(1,2,3)^T$ and $\\mathbf{y}=(2,1,0)^T$. Interpret the result.",ref:"Original"},
          {q:"Prove the Pythagorean theorem: if $\\langle\\mathbf{u},\\mathbf{v}\\rangle=0$ then $\\|\\mathbf{u}+\\mathbf{v}\\|^2=\\|\\mathbf{u}\\|^2+\\|\\mathbf{v}\\|^2$.",ref:"Axler LADR \u00a76.B"},
          {q:"Show the columns of any orthogonal matrix $Q$ ($Q^TQ=I$) are orthonormal, and $\\|Q\\mathbf{x}\\|=\\|\\mathbf{x}\\|$ for all $\\mathbf{x}$ \u2014 orthogonal maps preserve lengths.",ref:"Strang 18.06, PS4"},
        ]},
      { id:"3.5", title:"Orthonormal Basis", pages:"78–79",
        why:"ONBs simplify computations dramatically. QR decomposition produces a numerically stable ONB.",
        py:"## Building an Orthonormal Basis\n`np.linalg.qr` performs Gram-Schmidt under the hood: the columns of $Q$ form an orthonormal basis for the column space of $A$.\n\n```python\nimport numpy as np\n\nA = np.array([[1.0, 1.0], [1.0, 0.0], [0.0, 1.0]])\n\nQ, R = np.linalg.qr(A)\nprint(Q)                         # orthonormal basis (columns)\nprint(np.allclose(Q.T @ Q, np.eye(2)))  # True: Q^T Q = I\n```\n\nQR is the numerically stable way to orthonormalize a basis -- prefer it over hand-rolled Gram-Schmidt, which can lose orthogonality due to rounding error.",
        resources:[
          {name:"Strang 18.06 \u2014 Gram-Schmidt (Lec 17)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-17-orthogonal-matrices-and-gram-schmidt/"},
        ],
        exs:[
          {q:"Apply Gram-Schmidt to $\\{\\mathbf{v}_1=(1,1,0)^T,\\mathbf{v}_2=(1,0,1)^T,\\mathbf{v}_3=(0,1,1)^T\\}$ to obtain an orthonormal basis.",ref:"Strang 18.06, PS5"},
          {q:"If $Q$ has orthonormal columns, show $Q^{-1}=Q^T$ and $\\|Q\\mathbf{x}\\|=\\|\\mathbf{x}\\|$ for all $\\mathbf{x}$.",ref:"Original"},
          {q:"Verify $\\left\\{\\frac{1}{\\sqrt{2}}(1,1)^T,\\ \\frac{1}{\\sqrt{2}}(1,-1)^T\\right\\}$ is an ONB for $\\mathbb{R}^2$.",ref:"Original"},
          {q:"Express $\\mathbf{x}=(3,5,-2)^T$ in the ONB $\\mathbf{q}_1=\\frac{1}{\\sqrt{2}}(1,1,0)^T$, $\\mathbf{q}_2=\\frac{1}{\\sqrt{2}}(1,-1,0)^T$, $\\mathbf{q}_3=(0,0,1)^T$ using $x_i=\\langle\\mathbf{x},\\mathbf{q}_i\\rangle$.",ref:"Strang 18.06, PS5"},
          {q:"Perform QR decomposition on $A=\\begin{pmatrix}1&1\\\\1&0\\\\0&1\\end{pmatrix}$ via Gram-Schmidt. Verify $A=QR$.",ref:"Strang 18.06, PS5"},
        ]},
      { id:"3.6", title:"Orthogonal Complement", pages:"79–80",
        why:"Regression residuals live in $\\text{col}(A)^\\perp$ \u2014 understanding this is key to interpreting model fit.",
        py:"## Orthogonal Complements via Null Space\nThe orthogonal complement $U^\\perp$ of a subspace $U=\\text{span}(B)$ (columns of $B$) is exactly $\\text{null}(B^T)$.\n\n```python\nimport numpy as np\nfrom scipy.linalg import null_space\n\nB = np.array([[1.0],[1.0],[0.0]])  # U = span{(1,1,0)} in R^3\n\nU_perp = null_space(B.T)\nprint(U_perp)  # orthonormal basis for the orthogonal complement (a plane)\n\n# Sanity check: every column of U_perp is orthogonal to every column of B\nprint(np.allclose(B.T @ U_perp, 0))  # True\n```",
        resources:[
          {name:"Strang 18.06 \u2014 Orthogonal Subspaces (Lec 14)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-14-orthogonal-vectors-and-subspaces/"},
        ],
        exs:[
          {q:"Find the orthogonal complement of $V=\\text{span}\\{(1,1,0)^T,(0,1,1)^T\\}$ in $\\mathbb{R}^3$.",ref:"Original"},
          {q:"Prove: if $V\\subseteq\\mathbb{R}^n$, then $\\dim(V)+\\dim(V^\\perp)=n$.",ref:"Axler LADR \u00a76.C"},
          {q:"Verify $\\text{col}(A)^\\perp=\\text{null}(A^T)$ for $A=\\begin{pmatrix}1&2\\\\3&6\\end{pmatrix}$.",ref:"Strang 18.06, PS4"},
          {q:"Show $(V^\\perp)^\\perp=V$ for any subspace $V\\subseteq\\mathbb{R}^n$.",ref:"Axler LADR \u00a76.C"},
          {q:"In linear regression $\\hat{\\mathbf{y}}=A(A^TA)^{-1}A^T\\mathbf{y}$, show the residual $\\mathbf{e}=\\mathbf{y}-\\hat{\\mathbf{y}}$ lies in $\\text{col}(A)^\\perp$.",ref:"Strang 18.06, PS5"},
        ]},
      { id:"3.7", title:"Inner Product of Functions", pages:"80–81",
        why:"Kernels in SVMs and Gaussian processes generalise the dot product to function spaces.",
        py:"## Inner Products of Functions\nFunction inner products $\\langle f,g\\rangle=\\int f(x)g(x)\\,dx$ don't have a \"vector\" to hand `np.dot`, but `scipy.integrate.quad` evaluates the integral directly, which is the standard way to compute things like Fourier coefficients.\n\n```python\nimport numpy as np\nfrom scipy.integrate import quad\n\nf = lambda x: np.sin(x)\ng = lambda x: np.cos(x)\n\ninner, _ = quad(lambda x: f(x) * g(x), -np.pi, np.pi)\nprint(inner)  # ~0.0 -- sin and cos are orthogonal on [-pi, pi]\n```\n\nThis is the continuous analogue of the dot product, and underlies things like kernel methods that work in function spaces (RKHS).",
        resources:[
          {name:"MML book \u00a73.7 (focused reading, 2 pages)", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"Compute $\\langle\\sin(mx),\\sin(nx)\\rangle=\\int_0^\\pi\\sin(mx)\\sin(nx)\\,dx$ for $m\\neq n$ and $m=n$. Why is this central to Fourier series?",ref:"MML \u00a73.7"},
          {q:"Show $\\left\\{\\sqrt{2/\\pi}\\sin(nx)\\right\\}_{n=1}^\\infty$ forms an orthonormal set on $[0,\\pi]$.",ref:"Original"},
          {q:"Verify $\\{1,x,x^2\\}$ is NOT orthogonal under $\\langle f,g\\rangle=\\int_{-1}^1 f(x)g(x)\\,dx$. Apply Gram-Schmidt to find the first two Legendre polynomials.",ref:"Axler LADR \u00a76.A"},
          {q:"For $k(\\mathbf{x},\\mathbf{x}')=(\\mathbf{x}^T\\mathbf{x}'+1)^2$ with $\\mathbf{x}\\in\\mathbb{R}^2$, expand $k$ and identify the feature map $\\phi(\\mathbf{x})$ such that $k(\\mathbf{x},\\mathbf{x}')=\\langle\\phi(\\mathbf{x}),\\phi(\\mathbf{x}')\\rangle$.",ref:"Original"},
          {q:"Why might computing $k(\\mathbf{x},\\mathbf{x}')$ directly (the kernel trick) be preferable to computing $\\phi(\\mathbf{x})$ explicitly in high dimensions? Give a motivating example.",ref:"Original"},
        ]},
      { id:"3.8", title:"Orthogonal Projections", pages:"81–91",
        why:"THE most important section for ML: PCA, linear regression, and nearest-subspace classification are all orthogonal projections.",
        py:"## Orthogonal Projections\nProjecting $\\mathbf{x}$ onto the column space of $B$ uses the projection matrix $\\pi=B(B^TB)^{-1}B^T$ -- this *is* the least-squares formula behind linear regression (Ch 9).\n\n```python\nimport numpy as np\n\nB = np.array([[1.0, 0.0], [1.0, 1.0], [1.0, 2.0]])  # basis for subspace U\nx = np.array([6.0, 0.0, 0.0])\n\n# Projection matrix\nP = B @ np.linalg.inv(B.T @ B) @ B.T\nproj_x = P @ x\nprint(proj_x)\n\n# Equivalent (and more stable) via lstsq\ncoeffs, *_ = np.linalg.lstsq(B, x, rcond=None)\nprint(B @ coeffs)\n```\n\nPrefer `np.linalg.lstsq` over forming $(B^TB)^{-1}$ explicitly -- it's the same idea but numerically more robust.",
        resources:[
          {name:"Strang 18.06 \u2014 Projections (Lec 15)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-15-projections-onto-subspaces/"},
          {name:"Strang 18.06 \u2014 Least Squares (Lec 16)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-16-projection-matrices-and-least-squares/"},
        ],
        exs:[
          {q:"Project $\\mathbf{b}=(1,1,1)^T$ onto $\\text{col}(A)$ for $A=\\begin{pmatrix}1&0\\\\0&1\\\\1&1\\end{pmatrix}$. Verify the residual $\\mathbf{e}=\\mathbf{b}-\\hat{\\mathbf{b}}$ is orthogonal to $\\text{col}(A)$.",ref:"Strang 18.06, PS5"},
          {q:"Derive the projection matrix $P=A(A^TA)^{-1}A^T$ for a matrix with linearly independent columns. Verify $P^2=P$ (idempotent) and $P^T=P$ (symmetric).",ref:"Strang 18.06, PS5"},
          {q:"Project $\\mathbf{x}=(2,3)^T$ onto $\\text{span}\\{(1,2)^T\\}$ using $P=\\mathbf{v}\\mathbf{v}^T/(\\mathbf{v}^T\\mathbf{v})$. Verify the residual is orthogonal to $(1,2)^T$.",ref:"Original"},
          {q:"Show the minimiser of $\\|\\mathbf{y}-X\\boldsymbol{\\beta}\\|^2$ is $\\hat{\\boldsymbol{\\beta}}=(X^TX)^{-1}X^T\\mathbf{y}$ and that $X\\hat{\\boldsymbol{\\beta}}$ is the orthogonal projection of $\\mathbf{y}$ onto $\\text{col}(X)$.",ref:"Strang 18.06, PS5"},
          {q:"Show the 1D projection matrix $P=\\mathbf{v}\\mathbf{v}^T/(\\mathbf{v}^T\\mathbf{v})$ satisfies $P^2=P$. Compute $P$ for $\\mathbf{v}=(1,2,2)^T$.",ref:"Original"},
        ]},
      { id:"3.9", title:"Rotations", pages:"91–94",
        why:"Rotations are the canonical example of orthogonal transformations. They appear in 3D ML tasks (robotics, point clouds).",
        py:"## Rotation Matrices\nA 2D rotation by angle $\\theta$ is built directly from $\\sin$ and $\\cos$; in 3D, `scipy.spatial.transform.Rotation` builds rotation matrices from axis-angle, quaternion, or Euler-angle representations.\n\n```python\nimport numpy as np\nfrom scipy.spatial.transform import Rotation\n\ntheta = np.pi / 4  # 45 degrees\nR2 = np.array([[np.cos(theta), -np.sin(theta)],\n               [np.sin(theta),  np.cos(theta)]])\nprint(R2 @ np.array([1, 0]))  # rotated point\n\n# 3D rotation about the z-axis\nR3 = Rotation.from_euler('z', 45, degrees=True).as_matrix()\nprint(R3 @ np.array([1, 0, 0]))\n```\n\nEvery rotation matrix is orthogonal with $\\det(R)=1$ -- check with `np.allclose(R3 @ R3.T, np.eye(3))` and `np.linalg.det(R3)`.",
        resources:[
          {name:"3Blue1Brown \u2014 Determinants & eigenvectors", url:"https://www.youtube.com/watch?v=Ip3X9LOh2dk"},
        ],
        exs:[
          {q:"Write the 2D rotation matrix $R_{45^\\circ}$. Apply it to $(1,0)^T$ and $(0,1)^T$. Verify geometrically.",ref:"Original"},
          {q:"Show $R(\\theta)$ is orthogonal: $R(\\theta)R(\\theta)^T=I$.",ref:"Original"},
          {q:"Compute $\\det(R(\\theta))$ for any $\\theta$. What does this say about how rotations affect area/volume?",ref:"Original"},
          {q:"Show $R(\\theta_1)R(\\theta_2)=R(\\theta_1+\\theta_2)$. What algebraic structure do rotation matrices form?",ref:"Original"},
          {q:"Find the eigenvalues of $R(\\theta)=\\begin{pmatrix}\\cos\\theta&-\\sin\\theta\\\\\\sin\\theta&\\cos\\theta\\end{pmatrix}$. For what $\\theta$ are they real? Interpret geometrically.",ref:"Original"},
        ]},
    ]},
  { id:"ch4", num:4, title:"Matrix Decompositions", color:"#60a5fa",
    tagline:"Breaking matrices into structured, interpretable pieces.",
    frRef:"MML §4.8 · pp. 135–137",
    furtherReading:"This chapter's tools — determinants, eigendecomposition, Cholesky, and SVD — are the computational backbone of much of machine learning (see Press et al., Numerical Recipes, for practical algorithms). Eigendecomposition underlies a whole family of 'spectral methods': PCA (Ch 10), Fisher discriminant analysis, multidimensional scaling, Isomap, Laplacian eigenmaps, and spectral clustering all boil down to finding eigenvectors of some positive semi-definite matrix. The Cholesky decomposition shows up again whenever we need to sample from or differentiate through a Gaussian — e.g. the reparameterization trick used to train variational autoencoders. SVD generalizes eigendecomposition to non-square matrices and underlies low-rank approximation, data compression, and tensor decompositions (Tucker, CP) for higher-dimensional arrays.",
    sections:[
      { id:"4.1", title:"Determinant and Trace", pages:"99–105",
        why:"$\\det A$ = volume scaling factor; $\\text{tr}(A)=\\sum_i\\lambda_i$. Both appear in probability densities and optimisation.",
        py:"## Determinant and Trace\n`np.linalg.det` and `np.trace` are direct one-liners -- but in practice you rarely need the determinant's *value*; its *sign* (orientation) and *zero-ness* (singularity) are what matter most.\n\n```python\nimport numpy as np\n\nA = np.array([[1.0, 2.0], [3.0, 4.0]])\n\nprint(np.linalg.det(A))   # -2.0\nprint(np.trace(A))        # 5.0 (sum of eigenvalues)\n\n# Singularity check -- safer than det == 0 for floats\nprint(np.isclose(np.linalg.det(A), 0))  # False\n```\n\nFor large matrices, never compute $\\det(A)$ to check invertibility -- it overflows/underflows. Use `np.linalg.matrix_rank` or `np.linalg.cond` instead.",
        resources:[
          {name:"3Blue1Brown \u2014 Determinant (geometric view)", url:"https://www.youtube.com/watch?v=Ip3X9LOh2dk"},
          {name:"Paul's Notes \u2014 Matrices & Determinants (review)", url:"https://tutorial.math.lamar.edu/classes/de/la_matrix.aspx"},
        ],
        exs:[
          {q:"Compute $\\det(A)$ for $A=\\begin{pmatrix}2&1&-1\\\\0&3&2\\\\-1&1&4\\end{pmatrix}$ by cofactor expansion.",ref:"Paul's Notes, LinAlg"},
          {q:"For $A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$ and $B=\\begin{pmatrix}2&0\\\\1&3\\end{pmatrix}$, verify $\\det(AB)=\\det(A)\\det(B)$ and $\\text{tr}(A+B)=\\text{tr}(A)+\\text{tr}(B)$.",ref:"Original"},
          {q:"A $3\\times 3$ matrix has eigenvalues $2,3,-1$. What are its determinant and trace, without computing the matrix?",ref:"Original"},
          {q:"Show $\\det(A^T)=\\det(A)$ and $\\det(cA)=c^n\\det(A)$ for an $n\\times n$ matrix.",ref:"Strang 18.06, PS5"},
          {q:"Find a $2\\times 2$ symmetric matrix with $\\det=6$ and $\\text{tr}=5$. What are its eigenvalues? (Use $\\lambda_1\\lambda_2=\\det$ and $\\lambda_1+\\lambda_2=\\text{tr}$.)",ref:"Original"},
        ]},
      { id:"4.2", title:"Eigenvalues and Eigenvectors", pages:"105–114",
        why:"PCA, spectral clustering, PageRank, Markov chains \u2014 all fundamentally about eigenstructure.",
        py:"## Eigenvalues and Eigenvectors\n`np.linalg.eig` returns eigenvalues and eigenvectors (columns of the second output) for any square matrix; for symmetric matrices, prefer `np.linalg.eigh` -- it's faster and numerically more stable, and guarantees real eigenvalues.\n\n```python\nimport numpy as np\n\nA = np.array([[2.0, 1.0], [1.0, 2.0]])\n\neigvals, eigvecs = np.linalg.eigh(A)  # symmetric -> use eigh\nprint(eigvals)   # [1. 3.]\nprint(eigvecs)   # columns are the eigenvectors\n\n# Verify A v = lambda v\nv = eigvecs[:, 0]\nprint(np.allclose(A @ v, eigvals[0] * v))  # True\n```",
        resources:[
          {name:"3Blue1Brown \u2014 Eigenvectors (essential)", url:"https://www.youtube.com/watch?v=PFDu9oVAE-g"},
          {name:"Strang 18.06 \u2014 Eigenvalues (Lec 21)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-21-eigenvalues-and-eigenvectors/"},
        ],
        exs:[
          {q:"Find all eigenvalues and eigenvectors of $A=\\begin{pmatrix}3&1\\\\1&3\\end{pmatrix}$. Are the eigenvectors orthogonal?",ref:"Strang 18.06, PS6"},
          {q:"For $A=\\begin{pmatrix}0&-1\\\\1&0\\end{pmatrix}$ (90\u00b0 rotation), find the eigenvalues. What does a complex eigenvalue tell you geometrically?",ref:"Strang 18.06, PS6"},
          {q:"If $\\mathbf{v}$ is an eigenvector of $A$ with eigenvalue $\\lambda$, show it is an eigenvector of $A^2$, $A^k$, and $A^{-1}$. State the respective eigenvalues.",ref:"Original"},
          {q:"Show eigenvectors of a symmetric matrix for distinct eigenvalues are orthogonal. (Use $A\\mathbf{v}_1=\\lambda_1\\mathbf{v}_1$, $A\\mathbf{v}_2=\\lambda_2\\mathbf{v}_2$, take $\\mathbf{v}_1^T(A\\mathbf{v}_2)$.)",ref:"Strang 18.06, PS6"},
          {q:"Find eigenvalues and eigenvectors of $P=\\mathbf{v}\\mathbf{v}^T/\\|\\mathbf{v}\\|^2$ for $\\mathbf{v}=(1,1,0)^T$ (a projection matrix). Interpret geometrically.",ref:"Original"},
        ]},
      { id:"4.3", title:"Cholesky Decomposition", pages:"114–115",
        why:"Efficient factorisation of positive-definite matrices. Used in Gaussian process inference and covariance sampling.",
        py:"## Cholesky Decomposition\nFor a symmetric positive-definite matrix, `np.linalg.cholesky` factors $A=LL^T$ -- about twice as fast as a general LU decomposition, and the standard way to sample from a multivariate Gaussian.\n\n```python\nimport numpy as np\n\nA = np.array([[4.0, 2.0], [2.0, 3.0]])  # SPD\n\nL = np.linalg.cholesky(A)\nprint(L)\nprint(np.allclose(L @ L.T, A))  # True\n\n# Sampling from N(0, A): x = L @ z, z ~ N(0, I)\nz = np.random.randn(2, 10000)\nsamples = L @ z\nprint(np.cov(samples))  # approx A\n```",
        resources:[
          {name:"Wikipedia \u2014 Cholesky decomposition (intro + algorithm)", url:"https://en.wikipedia.org/wiki/Cholesky_decomposition"},
        ],
        exs:[
          {q:"Compute the Cholesky decomposition $A=LL^T$ for $A=\\begin{pmatrix}4&2\\\\2&3\\end{pmatrix}$. Verify $LL^T=A$.",ref:"Original"},
          {q:"Show $A=\\begin{pmatrix}1&2\\\\2&1\\end{pmatrix}$ is not positive definite \u2014 find $\\mathbf{x}$ with $\\mathbf{x}^TA\\mathbf{x}<0$. Why does Cholesky fail?",ref:"Original"},
          {q:"A matrix is positive definite iff all eigenvalues are positive. Verify this for $A=\\begin{pmatrix}5&2\\\\2&3\\end{pmatrix}$.",ref:"Strang 18.06, PS6"},
          {q:"Compute Cholesky for $A=\\begin{pmatrix}4&2&0\\\\2&5&1\\\\0&1&3\\end{pmatrix}$.",ref:"Original"},
          {q:"To sample $\\mathbf{x}\\sim\\mathcal{N}(\\mathbf{0},\\Sigma)$, compute $\\mathbf{x}=L\\mathbf{z}$ where $L=\\text{chol}(\\Sigma)$ and $\\mathbf{z}\\sim\\mathcal{N}(\\mathbf{0},I)$. Verify $\\mathbb{E}[\\mathbf{x}\\mathbf{x}^T]=\\Sigma$.",ref:"Original"},
        ]},
      { id:"4.4", title:"Eigendecomposition and Diagonalization", pages:"115–119",
        why:"Diagonalisation simplifies matrix powers and exponents \u2014 used in Markov chains and differential equations.",
        py:"## Eigendecomposition and Diagonalization\nA diagonalizable matrix can be written $A=PDP^{-1}$ where $D$ is diagonal of eigenvalues and $P$'s columns are eigenvectors -- this is exactly what `np.linalg.eig` returns.\n\n```python\nimport numpy as np\n\nA = np.array([[2.0, 0.0], [1.0, 3.0]])\n\neigvals, P = np.linalg.eig(A)\nD = np.diag(eigvals)\n\nprint(np.allclose(P @ D @ np.linalg.inv(P), A))  # True\n\n# Fast matrix powers via diagonalization: A^10\nA10 = P @ np.diag(eigvals**10) @ np.linalg.inv(P)\nprint(A10)\n```\n\nDiagonalization makes computing $A^n$ for large $n$ cheap -- raise the eigenvalues to the $n$-th power instead of repeated matrix multiplication.",
        resources:[
          {name:"Strang 18.06 \u2014 Diagonalisation (Lec 22)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-22-diagonalization-and-powers-of-a/"},
        ],
        exs:[
          {q:"Diagonalise $A=\\begin{pmatrix}3&1\\\\1&3\\end{pmatrix}$: find $P$ and $D$ such that $A=PDP^{-1}$.",ref:"Strang 18.06, PS6"},
          {q:"Use $A=PDP^{-1}$ to compute $A^{10}$ efficiently via $A^{10}=PD^{10}P^{-1}$.",ref:"Strang 18.06, PS6"},
          {q:"Verify both parts of the Spectral Theorem for $A=\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}$: real eigenvalues and orthogonal eigenvectors.",ref:"Strang 18.06, PS6"},
          {q:"Show $A=\\begin{pmatrix}1&1\\\\0&1\\end{pmatrix}$ has a repeated eigenvalue but only one linearly independent eigenvector. Why can't it be diagonalised?",ref:"Strang 18.06, PS7"},
          {q:"For symmetric $A=P\\Lambda P^T$ ($P$ orthogonal), show $A=\\sum_i\\lambda_i\\mathbf{p}_i\\mathbf{p}_i^T$ (spectral decomposition). Interpret each rank-1 term.",ref:"Original"},
        ]},
      { id:"4.5", title:"Singular Value Decomposition", pages:"119–129",
        why:"THE most important factorisation in ML: PCA, recommender systems, LSA, low-rank approximation all use SVD.",
        py:"## Singular Value Decomposition\n`np.linalg.svd` factors *any* matrix (square or not) as $A=U\\Sigma V^T$ -- the single most important decomposition in this book, underlying PCA (Ch 10) and low-rank approximation.\n\n```python\nimport numpy as np\n\nA = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])  # 3x2, not square\n\nU, S, Vt = np.linalg.svd(A, full_matrices=False)\nprint(S)  # singular values, descending\n\n# Reconstruct A\nprint(np.allclose(U @ np.diag(S) @ Vt, A))  # True\n```\n\nFor symmetric PSD matrices, the singular values equal the eigenvalues, and SVD reduces to eigendecomposition -- but SVD works for *every* matrix, which is why it's preferred in numerical linear algebra.",
        resources:[
          {name:"Strang 18.06 \u2014 SVD (Lec 29)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-29-singular-value-decomposition/"},
          {name:"Visual Kernel \u2014 SVD Visualized", url:"https://www.youtube.com/watch?v=vSczTbgc8Rc"},
        ],
        exs:[
          {q:"Compute the SVD of $A=\\begin{pmatrix}1&1\\\\0&1\\\\1&0\\end{pmatrix}$ by: (1) eigendecomposing $A^TA$, (2) computing $V$, $\\Sigma$, then $U=AV\\Sigma^{-1}$.",ref:"Strang 18.06, PS9"},
          {q:"Express $A=U\\Sigma V^T$ as a sum of rank-1 matrices $\\sigma_i\\mathbf{u}_i\\mathbf{v}_i^T$. What does the first term represent?",ref:"Original"},
          {q:"The condition number is $\\kappa(A)=\\sigma_{\\max}/\\sigma_{\\min}$. For $A=\\begin{pmatrix}3&0\\\\0&0.01\\end{pmatrix}$, compute $\\kappa(A)$ and explain what a large condition number implies for solving $A\\mathbf{x}=\\mathbf{b}$.",ref:"Original"},
          {q:"Show $\\text{rank}(A)=$ number of non-zero singular values, and $\\|A\\|_F=\\sqrt{\\sum_i\\sigma_i^2}$.",ref:"MML \u00a74.5"},
          {q:"For invertible $A=U\\Sigma V^T$, show $A^{-1}=V\\Sigma^{-1}U^T$. Verify for $A=\\begin{pmatrix}2&0\\\\0&3\\end{pmatrix}$.",ref:"Original"},
        ]},
      { id:"4.6", title:"Matrix Approximation", pages:"129–134",
        why:"Low-rank approximation = data compression. Used in PCA, collaborative filtering, and efficient attention.",
        py:"## Low-Rank Matrix Approximation\nThe Eckart-Young theorem says the best rank-$k$ approximation of $A$ (in spectral or Frobenius norm) is obtained by truncating its SVD to the top $k$ singular values -- the basis of compression and PCA.\n\n```python\nimport numpy as np\n\nA = np.random.randn(50, 30)\n\nU, S, Vt = np.linalg.svd(A, full_matrices=False)\n\nk = 5\nA_k = U[:, :k] @ np.diag(S[:k]) @ Vt[:k, :]\n\nprint(np.linalg.matrix_rank(A_k))               # 5\nprint(np.linalg.norm(A - A_k, 'fro'))           # approximation error\nprint(np.linalg.norm(A, 'fro'))                 # original \"size\" for comparison\n```\n\nThe approximation error equals $\\sqrt{\\sum_{i>k}\\sigma_i^2}$ -- so the dropped singular values directly tell you how much information you lose.",
        resources:[
          {name:"MML book \u00a74.6 (read alongside \u00a74.5)", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"$A=\\text{diag}(5,3,1)$. Write the rank-1 and rank-2 best approximations in terms of SVD.",ref:"MML \u00a74.6"},
          {q:"By Eckart-Young, the best rank-$k$ approx. is $\\hat{A}_k=\\sum_{i=1}^k\\sigma_i\\mathbf{u}_i\\mathbf{v}_i^T$. For $A=\\begin{pmatrix}3&0\\\\0&2\\\\0&0\\end{pmatrix}$, compute $\\hat{A}_1$ and $\\|A-\\hat{A}_1\\|_F$.",ref:"MML \u00a74.6"},
          {q:"A $1000\\times500$ matrix has rank 5. Compare storage: full matrix vs. rank-5 SVD ($U_{1000\\times5},\\Sigma_{5\\times5},V_{500\\times5}$). What is the compression ratio?",ref:"Original"},
          {q:"Show the best rank-1 approximation to $A=\\begin{pmatrix}2&0\\\\0&1\\end{pmatrix}$ is $\\hat{A}_1=\\begin{pmatrix}2&0\\\\0&0\\end{pmatrix}$. Compute $\\|A-\\hat{A}_1\\|_F$.",ref:"Original"},
          {q:"In PCA we project data onto the top-$k$ eigenvectors of the covariance matrix. Show this is equivalent to finding the best rank-$k$ approximation of the centred data matrix.",ref:"MML \u00a710.2"},
        ]},
    ]},
  { id:"ch5", num:5, title:"Vector Calculus", color:"#f472b6",
    tagline:"Gradients, Jacobians, and backprop — the engine of learning.",
    frRef:"MML §5.9 · p. 170",
    furtherReading:"For a deeper treatment of matrix calculus, see Magnus & Neudecker; for automatic differentiation, Griewank & Walther. A recurring problem in ML is computing $\\mathbb{E}_x[f(x)]$ when $f$ is nonlinear — even for a Gaussian $p(x)$, this integral is usually intractable. The first-order Taylor expansion used here to linearize $f$ is exactly the trick behind the extended Kalman filter for tracking nonlinear dynamical systems; the unscented transform and the Laplace approximation (a second-order version using the Hessian) are two alternative ways to approximate the same kind of integral, and both reappear throughout probabilistic ML.",
    sections:[
      { id:"5.1", title:"Differentiation of Univariate Functions", pages:"141–146",
        why:"Chain rule $\\Rightarrow$ backprop. Product rule $\\Rightarrow$ gradient of composite losses. All gradient-based ML builds from here.",
        py:"## Symbolic and Numerical Differentiation\n`sympy` computes derivatives symbolically (exact, closed-form), while finite differences (or `scipy.misc.derivative`-style approaches) approximate them numerically -- useful for sanity-checking gradients.\n\n```python\nimport sympy as sp\n\nx = sp.symbols('x')\nf = sp.exp(x) * sp.sin(x)\n\ndf = sp.diff(f, x)\nprint(df)               # exp(x)*sin(x) + exp(x)*cos(x)\nprint(df.subs(x, 0))    # value at x=0\n\n# Numerical check via central difference\nimport numpy as np\nf_num = sp.lambdify(x, f, 'numpy')\nh = 1e-6\nx0 = 0.0\napprox = (f_num(x0+h) - f_num(x0-h)) / (2*h)\nprint(approx)  # ~1.0, matches df at x=0\n```",
        resources:[
          {name:"Paul's Notes \u2014 Differentiation Formulas (practice)", url:"https://tutorial.math.lamar.edu/problems/calci/diffformulas.aspx"},
          {name:"Khan Academy \u2014 Derivative as a concept", url:"https://www.khanacademy.org/math/ap-calculus-ab/ab-differentiation-1-new/ab-2-1/v/derivative-as-a-concept"},
        ],
        exs:[
          {q:"Differentiate: (a) $f(x)=x^3\\ln x$, (b) $g(x)=\\sin(x^2)e^x$, (c) $\\sigma(x)=\\frac{1}{1+e^{-x}}$ (sigmoid). Show full working.",ref:"Paul's Notes, CalcI"},
          {q:"Use the chain rule to find $\\frac{d}{dx}(3x^2+2x)^5$.",ref:"Paul's Notes, CalcI"},
          {q:"Find all critical points of $f(x)=x^4-4x^2+3$ and classify each as a local min, max, or neither.",ref:"Paul's Notes, CalcI"},
          {q:"The ReLU function is $\\text{ReLU}(x)=\\max(0,x)$. Where is it differentiable? What is its derivative where defined? Why use it despite non-differentiability at $0$?",ref:"Original"},
          {q:"Find the 3rd-order Taylor series of $\\sigma(x)=1/(1+e^{-x})$ around $x=0$. Is this the same as $\\tfrac{1}{2}+\\tfrac{1}{2}\\tanh(x/2)$?",ref:"Original"},
        ]},
      { id:"5.2", title:"Partial Differentiation and Gradients", pages:"146–149",
        why:"$\\nabla f$ points in the direction of steepest ascent. Gradient descent moves against $\\nabla f$ to minimise the loss.",
        py:"## Gradients with Autodiff\nFor $f:\\mathbb{R}^n\\to\\mathbb{R}$, the gradient $\\nabla f$ is a vector of partial derivatives. Hand-coding these is error-prone -- `autograd` or `jax` compute exact gradients automatically.\n\n```python\nimport jax.numpy as jnp\nfrom jax import grad\n\ndef f(x):\n    return x[0]**2 * x[1] + jnp.sin(x[1])\n\ngrad_f = grad(f)\nx = jnp.array([2.0, 1.0])\nprint(grad_f(x))  # [df/dx0, df/dx1] evaluated at x\n```\n\nThis is exactly the mechanism behind `loss.backward()` in PyTorch -- automatic differentiation, not symbolic or numerical differentiation.",
        resources:[
          {name:"Paul's Notes \u2014 Partial Derivatives (practice)", url:"https://tutorial.math.lamar.edu/problems/calciii/partialderivatives.aspx"},
          {name:"Khan Academy \u2014 Partial derivatives, introduction", url:"https://www.khanacademy.org/math/multivariable-calculus/multivariable-derivatives/partial-derivatives/v/partial-derivatives-introduction"},
        ],
        exs:[
          {q:"For $f(x,y)=x^2y+y^3-3xy$, compute $\\partial f/\\partial x$, $\\partial f/\\partial y$, and $\\nabla f$ at $(1,2)$.",ref:"Paul's Notes, CalcIII"},
          {q:"For $f(x,y)=e^{x^2+y^2}$, find $\\nabla f$ and determine the direction of fastest increase at $(1,1)$. What is the rate of increase?",ref:"Paul's Notes, CalcIII"},
          {q:"Compute the Hessian of $f(x,y)=x^3+y^3-3xy$. Find all critical points and classify them.",ref:"Paul's Notes, CalcIII"},
          {q:"Verify Clairaut's theorem for $f(x,y,z)=x^2ye^z+yz^3$: show $\\partial^2f/\\partial x\\partial y=\\partial^2f/\\partial y\\partial x$.",ref:"Original"},
          {q:"The MSE gradient is $\\nabla_\\mathbf{w}L=-\\frac{2}{n}X^T(\\mathbf{y}-X\\mathbf{w})$ for $L=\\frac{1}{n}\\|\\mathbf{y}-X\\mathbf{w}\\|_2^2$. Derive this from partial derivatives.",ref:"MML \u00a75.2"},
        ]},
      { id:"5.3", title:"Gradients of Vector-Valued Functions", pages:"149–155",
        why:"The Jacobian generalises gradients to multi-output functions \u2014 essential for understanding signal flow between layers.",
        py:"## Jacobians of Vector-Valued Functions\nFor $f:\\mathbb{R}^n\\to\\mathbb{R}^m$, the Jacobian is an $m\\times n$ matrix of all partial derivatives -- `jax.jacobian` (or `torch.autograd.functional.jacobian`) computes it directly.\n\n```python\nimport jax.numpy as jnp\nfrom jax import jacobian\n\ndef f(x):\n    return jnp.array([x[0]**2 + x[1], x[0]*x[1], jnp.sin(x[0])])\n\nJ = jacobian(f)\nx = jnp.array([1.0, 2.0])\nprint(J(x))  # 3x2 Jacobian matrix\n```\n\nThe shape of the Jacobian is `(output_dim, input_dim)` -- a useful sanity check whenever you derive one by hand.",
        resources:[
          {name:"Khan Academy \u2014 The Jacobian matrix", url:"https://www.khanacademy.org/math/multivariable-calculus/multivariable-derivatives/jacobian/v/the-jacobian-matrix"},
          {name:"Paul's Notes \u2014 Directional Derivatives (practice)", url:"https://tutorial.math.lamar.edu/problems/calciii/directionalderiv.aspx"},
        ],
        exs:[
          {q:"Compute the Jacobian of $\\mathbf{f}:\\mathbb{R}^2\\to\\mathbb{R}^2$, $\\mathbf{f}(x,y)=(x^2+y,\\ xy-x)^T$. Evaluate at $(1,2)$.",ref:"Original"},
          {q:"For $\\mathbf{f}(\\mathbf{x})=A\\mathbf{x}$ where $A\\in\\mathbb{R}^{m\\times n}$, what is the Jacobian $\\partial\\mathbf{f}/\\partial\\mathbf{x}$?",ref:"MML \u00a75.3"},
          {q:"Verify the chain rule via Jacobians: $f(u)=u^2$, $\\mathbf{g}(x)=(x,x^2)^T$. Compute $d(f\\circ\\mathbf{g})/dx$ directly and via $\\frac{df}{d\\mathbf{u}}\\cdot\\frac{d\\mathbf{g}}{dx}$.",ref:"MML \u00a75.3"},
          {q:"For softmax $y_i=e^{z_i}/\\sum_j e^{z_j}$, compute $\\partial y_i/\\partial z_j$ and show it equals $y_i(\\delta_{ij}-y_j)$.",ref:"Original"},
          {q:"The directional derivative of $f$ in direction $\\mathbf{d}$ is $D_\\mathbf{d}f=\\nabla f\\cdot\\hat{\\mathbf{d}}$. For $f(x,y)=x^2+2y^2$, compute it at $(1,1)$ in direction $(1,1)^T$.",ref:"Paul's Notes, CalcIII"},
        ]},
      { id:"5.4", title:"Gradients of Matrices", pages:"155–158",
        why:"Essential for ML update rules: $\\partial\\|X\\mathbf{w}-\\mathbf{y}\\|^2/\\partial\\mathbf{w}$ is the key gradient for linear regression.",
        py:"## Gradients with Respect to Matrices\nGradients of scalar functions w.r.t. matrices (e.g. $\\nabla_W \\, \\mathbf{x}^TW\\mathbf{x}$) show up constantly in ML. `jax.grad` differentiates through matrix-valued inputs just as easily as vectors.\n\n```python\nimport jax.numpy as jnp\nfrom jax import grad\n\ndef f(W):\n    x = jnp.array([1.0, 2.0])\n    return x @ W @ x  # scalar\n\nW = jnp.array([[1.0, 0.0], [0.0, 1.0]])\ndW = grad(f)(W)\nprint(dW)  # gradient has the same shape as W\n```\n\nThe gradient of a scalar w.r.t. a matrix always has the *same shape as the matrix* -- a quick shape check catches most by-hand differentiation mistakes.",
        resources:[
          {name:"Matrix Cookbook \u2014 Sections 2\u20133 (free)", url:"https://www.math.uwaterloo.ca/~hwolkowi/matrixcookbook.pdf"},
        ],
        exs:[
          {q:"Compute $\\partial/\\partial\\mathbf{w}\\,\\|\\mathbf{y}-X\\mathbf{w}\\|_2^2$ where $\\mathbf{y}\\in\\mathbb{R}^n$, $X\\in\\mathbb{R}^{n\\times d}$, $\\mathbf{w}\\in\\mathbb{R}^d$.",ref:"MML \u00a75.4"},
          {q:"Compute $\\partial/\\partial A\\,\\text{tr}(A^TA)$. Show the answer is $2A$.",ref:"Matrix Cookbook \u00a72"},
          {q:"Derive $\\partial(\\mathbf{a}^TW\\mathbf{b})/\\partial W=\\mathbf{a}\\mathbf{b}^T$ for fixed column vectors $\\mathbf{a},\\mathbf{b}$.",ref:"Matrix Cookbook \u00a72"},
          {q:"Set $\\nabla_\\mathbf{w}\\|\\mathbf{y}-X\\mathbf{w}\\|^2=\\mathbf{0}$ and derive the normal equations $(X^TX)\\hat{\\mathbf{w}}=X^T\\mathbf{y}$.",ref:"MML \u00a75.4"},
          {q:"Derive $\\nabla_\\mathbf{w}(\\|\\mathbf{y}-X\\mathbf{w}\\|^2+\\lambda\\|\\mathbf{w}\\|^2)$ and solve for the ridge regression estimate $\\hat{\\mathbf{w}}$.",ref:"MML \u00a75.5"},
        ]},
      { id:"5.5", title:"Useful Identities for Computing Gradients", pages:"158–159",
        why:"Knowing $\\partial(\\mathbf{x}^TA\\mathbf{x})/\\partial\\mathbf{x}=(A+A^T)\\mathbf{x}$ saves hours when deriving ML update rules.",
        py:"## Verifying Gradient Identities Symbolically\nRather than memorizing identities like $\\nabla_x(\\mathbf{a}^T\\mathbf{x})=\\mathbf{a}$ or $\\nabla_x(\\mathbf{x}^TA\\mathbf{x})=(A+A^T)\\mathbf{x}$, you can verify them symbolically with `sympy` for small dimensions.\n\n```python\nimport sympy as sp\n\nx1, x2 = sp.symbols('x1 x2')\nx = sp.Matrix([x1, x2])\nA = sp.Matrix([[2, 1], [0, 3]])\n\nf = (x.T * A * x)[0]  # x^T A x as a scalar\ngrad_f = sp.Matrix([sp.diff(f, xi) for xi in x])\n\nprint(grad_f)\nprint(sp.simplify(grad_f - (A + A.T) * x))  # should be the zero vector\n```",
        resources:[
          {name:"Matrix Cookbook \u2014 Section 2 (derivatives)", url:"https://www.math.uwaterloo.ca/~hwolkowi/matrixcookbook.pdf"},
        ],
        exs:[
          {q:"Verify $\\partial(\\mathbf{x}^TA\\mathbf{x})/\\partial\\mathbf{x}=(A+A^T)\\mathbf{x}$ for $A=\\begin{pmatrix}1&2\\\\0&3\\end{pmatrix}$, $\\mathbf{x}=(x_1,x_2)^T$ by direct computation.",ref:"MML \u00a75.5"},
          {q:"Compute $\\partial\\log\\det(X)/\\partial X$ for invertible $X$. (The answer is $X^{-T}$; use $d\\log\\det(X)=\\text{tr}(X^{-1}dX)$.)",ref:"Matrix Cookbook \u00a72"},
          {q:"For symmetric $A$, show $\\nabla_\\mathbf{w}(\\mathbf{w}^TA\\mathbf{w})=2A\\mathbf{w}$ using the identity above.",ref:"Original"},
          {q:"Compute $\\nabla_{\\boldsymbol{\\mu}}\\left[-\\tfrac{1}{2}(\\mathbf{x}-\\boldsymbol{\\mu})^T\\Sigma^{-1}(\\mathbf{x}-\\boldsymbol{\\mu})\\right]$ (gradient of Gaussian log-likelihood w.r.t. mean).",ref:"Original"},
          {q:"Compute $\\partial/\\partial X\\,\\|AX-B\\|_F^2$ where $A,B,X$ are matrices. (Hint: $\\|M\\|_F^2=\\text{tr}(M^TM)$.)",ref:"Matrix Cookbook \u00a72"},
        ]},
      { id:"5.6", title:"Backpropagation and Automatic Differentiation", pages:"159–164",
        why:"How modern ML actually computes gradients. Essential for debugging networks and understanding training.",
        py:"## Backpropagation = Reverse-Mode Autodiff\nBackprop is just the chain rule applied in reverse, accumulating local gradients through a computational graph. PyTorch's `autograd` builds this graph automatically as you compute.\n\n```python\nimport torch\n\nx = torch.tensor(2.0, requires_grad=True)\nW = torch.tensor(3.0, requires_grad=True)\n\na = W * x          # forward pass\ny = torch.sin(a)   # forward pass\n\ny.backward()       # reverse-mode autodiff\nprint(x.grad)      # dy/dx = cos(a) * W\nprint(W.grad)      # dy/dW = cos(a) * x\n```\n\n`y.backward()` walks the computational graph from output to inputs, applying the chain rule at each node -- exactly the algorithm in MML §5.6.",
        resources:[
          {name:"Karpathy \u2014 micrograd walkthrough (must watch)", url:"https://www.youtube.com/watch?v=VMj-3S1tku0"},
          {name:"CS231n \u2014 Backprop notes", url:"https://cs231n.github.io/optimization-2/"},
        ],
        exs:[
          {q:"Draw the computational graph for $f(x,y)=(x+y)(y+1)$. Run forward pass at $(1,2)$, then backward pass to get $\\partial f/\\partial x$ and $\\partial f/\\partial y$.",ref:"CS231n, Notes"},
          {q:"For 1-layer network $L=\\|\\sigma(W\\mathbf{x})-\\mathbf{y}\\|^2$ ($\\sigma$ = sigmoid elementwise), derive $\\partial L/\\partial W$ step-by-step via chain rule.",ref:"MML \u00a75.6"},
          {q:"What is the difference between forward-mode and reverse-mode autodiff? For $f:\\mathbb{R}^n\\to\\mathbb{R}$, which is more efficient for computing $\\nabla f$? Why?",ref:"MML \u00a75.6"},
          {q:"The sigmoid gradient is $\\sigma'(x)=\\sigma(x)(1-\\sigma(x))$. Derive this. Then compute $\\partial L/\\partial w$ for $L=\\sigma(wx)^2$.",ref:"Original"},
          {q:"Compute $\\partial L/\\partial W$ for cross-entropy + softmax: $L=-\\mathbf{y}^T\\log(\\text{softmax}(W\\mathbf{x}))$. Start with $\\partial L/\\partial(W\\mathbf{x})$ and apply the chain rule.",ref:"CS231n, Notes"},
        ]},
      { id:"5.7", title:"Higher-Order Derivatives", pages:"164–165",
        why:"The Hessian describes curvature \u2014 used in second-order optimisers (Newton's method, L-BFGS, natural gradient).",
        py:"## Higher-Order Derivatives: the Hessian\nThe Hessian (matrix of second partial derivatives) tells you about curvature -- it's central to Newton's method and to checking whether a critical point is a minimum, maximum, or saddle.\n\n```python\nimport jax.numpy as jnp\nfrom jax import hessian\n\ndef f(x):\n    return x[0]**2 + x[0]*x[1] + 3*x[1]**2\n\nH = hessian(f)\nx = jnp.array([1.0, 1.0])\nprint(H(x))  # [[2, 1], [1, 6]]\n\n# Eigenvalues > 0 everywhere -> f is convex (positive definite Hessian)\nprint(jnp.linalg.eigvalsh(H(x)))\n```",
        resources:[
          {name:"Paul's Notes \u2014 Higher Order Partial Derivatives (practice)", url:"https://tutorial.math.lamar.edu/problems/calciii/HighOrderPartialDerivs.aspx"},
        ],
        exs:[
          {q:"Compute the Hessian of $f(x,y,z)=x^2y+yz^2+xz$. Verify it is symmetric.",ref:"Paul's Notes, CalcIII"},
          {q:"Find all inflection points of $f(x)=x^4-4x^2+3$ (where $f''$ changes sign).",ref:"Paul's Notes, CalcI"},
          {q:"Classify all critical points of $f(x,y)=x^2-y^2$ using the second-derivative test.",ref:"Paul's Notes, CalcIII"},
          {q:"Derive Newton's method $\\mathbf{x}_{k+1}=\\mathbf{x}_k-[H_f(\\mathbf{x}_k)]^{-1}\\nabla f(\\mathbf{x}_k)$ from the 2nd-order Taylor expansion of $f$ around $\\mathbf{x}_k$.",ref:"MML \u00a77.1"},
          {q:"For $f(\\mathbf{x})=\\mathbf{x}^TA\\mathbf{x}$ with symmetric $A$, compute $\\nabla f$ and $H_f$. When does a minimum exist?",ref:"Original"},
        ]},
      { id:"5.8", title:"Linearization and Multivariate Taylor Series", pages:"165–170",
        why:"Taylor approximations justify gradient descent (1st order) and Newton's method (2nd order).",
        py:"## Taylor Series Approximation\nA first-order Taylor expansion $f(\\mathbf{x}_0+\\boldsymbol{\\delta})\\approx f(\\mathbf{x}_0)+\\nabla f(\\mathbf{x}_0)^T\\boldsymbol{\\delta}$ is the linear approximation that gradient descent implicitly relies on at each step.\n\n```python\nimport numpy as np\n\nf = lambda x: np.sin(x[0]) * x[1]\ngrad_f = lambda x: np.array([np.cos(x[0]) * x[1], np.sin(x[0])])\n\nx0 = np.array([0.0, 1.0])\ndelta = np.array([0.1, -0.05])\n\nexact = f(x0 + delta)\ntaylor1 = f(x0) + grad_f(x0) @ delta\nprint(exact, taylor1)  # close for small delta\n```\n\nThe smaller $\\|\\boldsymbol{\\delta}\\|$, the better the linear (first-order) approximation -- this is why gradient-descent step sizes need to be small.",
        resources:[
          {name:"Paul's Notes \u2014 Taylor Series (practice)", url:"https://tutorial.math.lamar.edu/problems/calcii/taylorseries.aspx"},
        ],
        exs:[
          {q:"Find the 2nd-order Taylor expansion of $f(x,y)=e^{x+y}$ around $(0,0)$. Evaluate the approximation error at $(0.1,0.1)$.",ref:"Paul's Notes, CalcII"},
          {q:"Linearise $f(x,y)=\\sqrt{x^2+y^2}$ near $(3,4)$. How accurate is the approximation at $(3.1,4.1)$?",ref:"Paul's Notes, CalcIII"},
          {q:"The GD step $\\mathbf{x}_{k+1}=\\mathbf{x}_k-\\alpha\\nabla f(\\mathbf{x}_k)$ follows from the 1st-order Taylor expansion. Derive it and find the condition on $\\alpha$ that ensures $f$ decreases.",ref:"MML \u00a75.8"},
          {q:"Write the 3rd-order Taylor series of $\\sin(x)$ around $x=0$. Compare to the exact value at $x=0.5$ rad and compute the error.",ref:"Paul's Notes, CalcII"},
          {q:"For $f(x,y)=x^2+xy+y^2$, verify the 2nd-order Taylor expansion $f(\\mathbf{x}_0+\\Delta)\\approx f(\\mathbf{x}_0)+\\nabla f^T\\Delta+\\frac{1}{2}\\Delta^TH_f\\Delta$ at $(1,1)$ with $\\Delta=(0.1,0.2)^T$.",ref:"MML \u00a75.8"},
        ]},
    ]},
  { id:"ch6", num:6, title:"Probability & Distributions", color:"#a78bfa",
    tagline:"Uncertainty, inference, and the Gaussian — the language of ML.",
    frRef:"MML §6.8 · pp. 221–222",
    furtherReading:"For gentler introductions to probability, try Grinstead & Snell or Walpole et al.; for the philosophy of probability, Hacking. We barely touched the exponential family — Barndorff-Nielsen covers it in depth, and a huge fraction of distributions used in ML (Gaussian, Bernoulli, Beta, Gamma, ...) belong to it, which is why conjugate priors exist at all. We also sidestepped measure theory entirely; that's fine for most ML purposes, but it matters for precise statements about conditional densities of continuous variables. The probabilistic language built here is put to direct use in Chapter 8 (probabilistic models), and ideas like normalizing flows extend the change-of-variables formula to deep generative models.",
    sections:[
      { id:"6.1", title:"Construction of a Probability Space", pages:"172–178",
        why:"The rigorous foundation of probability. Every probabilistic ML model \u2014 Bayesian or frequentist \u2014 rests on this.",
        py:"## Sample Spaces and Random Variables\n`numpy.random` (or the newer `Generator` API) simulates draws from a sample space -- a great way to build intuition for abstract probability-space definitions before the formal measure-theoretic machinery.\n\n```python\nimport numpy as np\n\nrng = np.random.default_rng(seed=0)\n\n# Sample space {1,...,6} for a die roll, X = outcome\nrolls = rng.integers(1, 7, size=10000)\n\n# Empirical probability of event A = {roll is even}\np_even = np.mean(rolls % 2 == 0)\nprint(p_even)  # ~0.5\n```\n\nEmpirical frequencies converging to theoretical probabilities (the law of large numbers) is the bridge between the formal axioms and how we *use* probability in practice.",
        resources:[
          {name:"Blitzstein & Hwang \u2014 Ch 1 (free book)", url:"https://stat110.hsites.harvard.edu/"},
          {name:"Stat 110 Lecture 1 (YouTube)", url:"https://www.youtube.com/watch?v=KbB0FjPg0mw"},
        ],
        exs:[
          {q:"A fair die is rolled. Define $\\Omega$, give a concrete event $A$, construct a $\\sigma$-algebra containing $A$, and define $P(A)$.",ref:"MML \u00a76.1"},
          {q:"Prove $P(A\\cup B)=P(A)+P(B)-P(A\\cap B)$ from the Kolmogorov axioms.",ref:"B&H \u00a71"},
          {q:"Given $P(A)=0.4$, $P(B)=0.3$, $P(A\\cap B)=0.1$, find $P(A\\cup B)$, $P(A^c)$, and $P(A^c\\cap B)$.",ref:"B&H \u00a71"},
          {q:"Prove the union bound: $P\\!\\left(\\bigcup_{i=1}^n A_i\\right)\\leq\\sum_{i=1}^n P(A_i)$. When does equality hold?",ref:"B&H \u00a71"},
          {q:"If $A\\cap B=\\emptyset$ (mutually exclusive), show $P(A\\cup B)=P(A)+P(B)$. Is mutual exclusivity the same as independence? Give a counterexample if not.",ref:"Original"},
        ]},
      { id:"6.2", title:"Discrete and Continuous Probabilities", pages:"178–183",
        why:"PMFs and PDFs are the building blocks of every generative model and likelihood function in ML.",
        py:"## Discrete and Continuous Distributions\n`scipy.stats` provides PMFs/PDFs, CDFs, sampling, and moments for dozens of standard distributions -- no need to hand-code formulas for the binomial, Poisson, or uniform distributions.\n\n```python\nfrom scipy import stats\n\n# Discrete: Binomial(n=10, p=0.3)\nbinom = stats.binom(n=10, p=0.3)\nprint(binom.pmf(3))   # P(X=3)\nprint(binom.mean())   # E[X] = np\n\n# Continuous: Uniform on [0, 2]\nuni = stats.uniform(loc=0, scale=2)\nprint(uni.pdf(1.0))   # density at x=1\nprint(uni.cdf(1.0))   # P(X <= 1)\n```",
        resources:[
          {name:"Blitzstein & Hwang \u2014 Ch 4\u20135 (continuous RVs)", url:"https://stat110.hsites.harvard.edu/"},
          {name:"Khan Academy \u2014 Constructing a probability distribution", url:"https://www.khanacademy.org/math/statistics-probability/random-variables-stats-library/random-variables-discrete/v/discrete-probability-distribution"},
        ],
        exs:[
          {q:"$X\\sim\\text{Poisson}(\\lambda=3)$. Find $P(X=2)$, $\\mathbb{E}[X]$, $\\text{Var}(X)$, and the CDF $P(X\\leq 2)$.",ref:"B&H \u00a74"},
          {q:"$X\\sim\\text{Uniform}(0,1)$. Find the PDF, CDF, $\\mathbb{E}[X]$, $\\text{Var}(X)$, and $P(0.2<X<0.7)$.",ref:"B&H \u00a75"},
          {q:"A continuous RV has PDF $f(x)=cx^2$ on $[0,2]$ (zero elsewhere). Find $c$, $\\mathbb{E}[X]$, and $\\text{Var}(X)$.",ref:"B&H \u00a75"},
          {q:"$X\\sim\\text{Geometric}(p)$: number of trials until first success. Show $P(X=k)=(1-p)^{k-1}p$ for $k=1,2,\\ldots$ and find $\\mathbb{E}[X]$.",ref:"B&H \u00a74"},
          {q:"The CDF $F(x)=1-e^{-\\lambda x}$ for $x\\geq 0$ defines the exponential distribution. Find the PDF, $\\mathbb{E}[X]$, and the median.",ref:"B&H \u00a75"},
        ]},
      { id:"6.3", title:"Sum Rule, Product Rule, and Bayes' Theorem", pages:"183–186",
        why:"Bayes' theorem is the foundation of all probabilistic inference in ML. Every probabilistic model uses it.",
        py:"## Sum Rule, Product Rule, and Bayes' Theorem\nBayes' theorem $p(x|y)=\\frac{p(y|x)p(x)}{p(y)}$ can be implemented directly on a joint probability table -- a useful way to build intuition before moving to continuous densities.\n\n```python\nimport numpy as np\n\n# Joint table p(x, y) for x in {0,1}, y in {0,1}\njoint = np.array([[0.3, 0.1],\n                   [0.2, 0.4]])  # rows = x, cols = y\n\np_x = joint.sum(axis=1)          # sum rule: marginal p(x)\np_y = joint.sum(axis=0)          # marginal p(y)\n\np_y_given_x = joint / p_x[:, None]  # product rule: p(y|x)\n\n# Bayes: p(x|y) = p(y|x) p(x) / p(y)\np_x_given_y = (p_y_given_x * p_x[:, None]) / p_y[None, :]\nprint(p_x_given_y)\n```",
        resources:[
          {name:"3Blue1Brown \u2014 Bayes' theorem (visual)", url:"https://www.youtube.com/watch?v=HZGCoVF3YvM"},
          {name:"Stat 110 Lec 4 (Bayes)", url:"https://www.youtube.com/watch?v=P7NE4WF8j-Q"},
        ],
        exs:[
          {q:"A test is 99\\% sensitive ($P(+|D)=0.99$) and 95\\% specific ($P(-|D^c)=0.95$). Disease prevalence is 1\\%. Compute $P(D|+)$. The answer may surprise you.",ref:"B&H \u00a72"},
          {q:"A bag has 3 red and 2 blue balls. Two drawn without replacement. Find $P(\\text{2nd}=\\text{red}\\mid\\text{1st}=\\text{red})$ and $P(\\text{2nd}=\\text{red})$.",ref:"B&H \u00a72"},
          {q:"Derive the law of total probability $P(A)=\\sum_i P(A|B_i)P(B_i)$ from the product rule, given a partition $\\{B_i\\}$ of $\\Omega$.",ref:"B&H \u00a72"},
          {q:"In a Bayesian model, the posterior is $p(\\theta|\\mathcal{D})\\propto p(\\mathcal{D}|\\theta)\\,p(\\theta)$. Identify the likelihood, prior, and normalising constant (evidence).",ref:"MML \u00a76.3"},
          {q:"$P(A)=P(B)=0.5$ and $P(A|B)=0.8$. Find $P(B|A)$. Are $A$ and $B$ independent?",ref:"B&H \u00a72"},
        ]},
      { id:"6.4", title:"Summary Statistics and Independence", pages:"186–197",
        why:"Mean, variance, and covariance describe your data. Independence assumptions underlie naive Bayes and factored models.",
        py:"## Mean, Variance, and Covariance\n`np.mean`, `np.var`, and `np.cov` compute the empirical analogues of $\\mathbb{E}[X]$, $\\mathbb{V}[X]$, and $\\text{Cov}[X,Y]$ -- the building blocks of every summary statistic in ML.\n\n```python\nimport numpy as np\n\nrng = np.random.default_rng(0)\nX = rng.normal(loc=2, scale=1, size=1000)\nY = 0.5 * X + rng.normal(scale=0.5, size=1000)\n\nprint(np.mean(X), np.var(X))      # ~2.0, ~1.0\n\ncov = np.cov(X, Y)                # 2x2 covariance matrix\nprint(cov)\n\n# Independence check via correlation\ncorr = np.corrcoef(X, Y)[0, 1]\nprint(corr)  # close to 0 only if X, Y uncorrelated\n```\n\nNote `np.cov` uses the unbiased (n-1) estimator by default -- pass `bias=True` to match the $1/n$ formula often used in derivations.",
        resources:[
          {name:"Blitzstein & Hwang \u2014 Ch 6 (expectation)", url:"https://stat110.hsites.harvard.edu/"},
          {name:"Khan Academy \u2014 Mean (expected value) of a discrete random variable", url:"https://www.khanacademy.org/math/ap-statistics/random-variables-ap/xfb5d8e68:mean-standard-deviation-random-variables/v/expected-value-of-a-discrete-random-variable"},
        ],
        exs:[
          {q:"Joint PMF: $P(0,0)=0.2$, $P(0,1)=0.3$, $P(1,0)=0.1$, $P(1,1)=0.4$. Find $\\mathbb{E}[X]$, $\\mathbb{E}[Y]$, $\\text{Cov}(X,Y)$, and test independence.",ref:"B&H \u00a76"},
          {q:"Prove $\\mathbb{E}[aX+b]=a\\mathbb{E}[X]+b$ and $\\text{Var}(aX+b)=a^2\\text{Var}(X)$ from the definitions.",ref:"B&H \u00a76"},
          {q:"For $X\\sim\\mathcal{N}(\\mu,\\sigma^2)$, compute $\\mathbb{E}[X^2]$ using $\\text{Var}(X)=\\mathbb{E}[X^2]-(\\mathbb{E}[X])^2$.",ref:"B&H \u00a76"},
          {q:"Show: if $X$ and $Y$ are independent, then $\\text{Cov}(X,Y)=0$. Does the converse hold? Give a counterexample if not.",ref:"B&H \u00a77"},
          {q:"For independent $X$ and $Y$, show $\\mathbb{E}[XY]=\\mathbb{E}[X]\\mathbb{E}[Y]$ and $\\text{Var}(X+Y)=\\text{Var}(X)+\\text{Var}(Y)$.",ref:"B&H \u00a76"},
        ]},
      { id:"6.5", title:"Gaussian Distribution", pages:"197–205",
        why:"The Gaussian is everywhere in ML: regression noise models, Gaussian processes, VAEs, and the Central Limit Theorem.",
        py:"## The Gaussian Distribution\nThe multivariate Gaussian $\\mathcal{N}(\\boldsymbol{\\mu},\\Sigma)$ is implemented by `scipy.stats.multivariate_normal` -- it underlies Gaussian processes, GMMs (Ch 11), and Bayesian linear regression (Ch 9).\n\n```python\nimport numpy as np\nfrom scipy.stats import multivariate_normal\n\nmu = np.array([0, 0])\nSigma = np.array([[1.0, 0.5], [0.5, 2.0]])\n\ndist = multivariate_normal(mean=mu, cov=Sigma)\n\nprint(dist.pdf([0, 0]))         # density at the mean\nsamples = dist.rvs(size=5, random_state=0)\nprint(samples)\n\n# Sampling via Cholesky (what's happening under the hood)\nL = np.linalg.cholesky(Sigma)\nz = np.random.randn(2)\nx = mu + L @ z\n```",
        resources:[
          {name:"Blitzstein & Hwang \u2014 Ch 5 (Normal distribution)", url:"https://stat110.hsites.harvard.edu/"},
          {name:"3Blue1Brown \u2014 Central Limit Theorem", url:"https://www.youtube.com/watch?v=zeJD6dqJ5lo"},
        ],
        exs:[
          {q:"$X\\sim\\mathcal{N}(5,4)$. Find $P(3<X<7)$ by standardising to $Z\\sim\\mathcal{N}(0,1)$ and using the 68-95-99.7 rule.",ref:"B&H \u00a75"},
          {q:"For $\\mathbf{x}\\sim\\mathcal{N}(\\boldsymbol{\\mu},\\Sigma)$ with $\\boldsymbol{\\mu}=(1,2)^T$ and $\\Sigma=\\begin{pmatrix}2&1\\\\1&1\\end{pmatrix}$, compute the Mahalanobis distance of $\\mathbf{x}=(3,3)^T$ from $\\boldsymbol{\\mu}$.",ref:"MML \u00a76.5"},
          {q:"Show: if $X\\sim\\mathcal{N}(\\mu,\\sigma^2)$ and $Y=aX+b$, then $Y\\sim\\mathcal{N}(a\\mu+b,a^2\\sigma^2)$.",ref:"B&H \u00a75"},
          {q:"If $X\\sim\\mathcal{N}(0,1)$, find $P(|X|>2)$. Why do we often assume Gaussian noise in ML?",ref:"B&H \u00a75"},
          {q:"For independent $X\\sim\\mathcal{N}(\\mu_1,\\sigma_1^2)$ and $Y\\sim\\mathcal{N}(\\mu_2,\\sigma_2^2)$, show $X+Y\\sim\\mathcal{N}(\\mu_1+\\mu_2,\\sigma_1^2+\\sigma_2^2)$.",ref:"B&H \u00a77"},
        ]},
      { id:"6.6", title:"Conjugacy and the Exponential Family", pages:"205–214",
        why:"Conjugate priors make Bayesian inference analytically tractable \u2014 the key to efficient Bayesian ML.",
        py:"## Conjugate Priors\nA Beta-Bernoulli conjugate pair means the posterior stays Beta after observing data -- updating it is just adding counts to the prior's parameters, no integration required.\n\n```python\nfrom scipy import stats\nimport numpy as np\n\n# Prior: Beta(alpha=2, beta=2) belief about a coin's bias\nalpha, beta = 2, 2\n\n# Observe data: 7 heads, 3 tails\nheads, tails = 7, 3\n\n# Posterior is also Beta -- conjugacy means the update is closed-form\nposterior = stats.beta(alpha + heads, beta + tails)\nprint(posterior.mean())   # updated belief about p(heads)\nprint(posterior.std())    # uncertainty shrinks with more data\n```\n\nThis closed-form update is exactly why conjugate priors are computationally convenient -- no MCMC or variational inference needed.",
        resources:[
          {name:"Blitzstein & Hwang \u2014 Ch 8 (conjugacy examples)", url:"https://stat110.hsites.harvard.edu/"},
        ],
        exs:[
          {q:"If $\\theta\\sim\\text{Beta}(\\alpha,\\beta)$ and $X|\\theta\\sim\\text{Binomial}(n,\\theta)$, show the posterior is $\\theta|X=k\\sim\\text{Beta}(\\alpha+k,\\beta+n-k)$.",ref:"B&H \u00a78"},
          {q:"Express $\\mathcal{N}(\\mu,\\sigma^2)$ in exponential family form $p(x|\\boldsymbol{\\eta})=h(x)\\exp(\\boldsymbol{\\eta}^T T(x)-A(\\boldsymbol{\\eta}))$. Identify $\\boldsymbol{\\eta}$, $T(x)$, and $A(\\boldsymbol{\\eta})$.",ref:"MML \u00a76.6"},
          {q:"What does 'conjugate prior' mean intuitively? Why is conjugacy computationally convenient? Give one ML scenario where this matters.",ref:"Original"},
          {q:"For Gaussian likelihood $p(x|\\mu)=\\mathcal{N}(x;\\mu,\\sigma^2)$ (known $\\sigma^2$) and prior $\\mu\\sim\\mathcal{N}(\\mu_0,\\tau^2)$, derive the posterior $p(\\mu|x_1,\\ldots,x_n)$.",ref:"MML \u00a76.6"},
          {q:"Show the Bernoulli distribution is in the exponential family. What is the natural parameter?",ref:"MML \u00a76.6"},
        ]},
      { id:"6.7", title:"Change of Variables / Inverse Transform", pages:"214–221",
        why:"Normalising flows, the reparameterisation trick in VAEs, and density estimation all rely on this.",
        py:"## Change of Variables\nIf $Y=g(X)$, the change-of-variables formula $p_Y(y)=p_X(g^{-1}(y))\\left|\\frac{dg^{-1}}{dy}\\right|$ can be checked numerically by comparing a transformed-sample histogram to the analytic density.\n\n```python\nimport numpy as np\nfrom scipy import stats\nimport matplotlib.pyplot as plt\n\n# X ~ Uniform(0,1), Y = -log(X) ~ Exponential(1)\nrng = np.random.default_rng(0)\nx = rng.uniform(0, 1, size=100000)\ny = -np.log(x)\n\n# Compare empirical distribution of Y to the analytic Exponential(1) pdf\ngrid = np.linspace(0, 8, 200)\nplt.hist(y, bins=80, density=True, alpha=0.5)\nplt.plot(grid, stats.expon().pdf(grid))\n```\n\nThis \"transform a uniform sample\" trick (the inverse transform method) is how most random-number generators sample from non-uniform distributions.",
        resources:[
          {name:"Blitzstein & Hwang \u2014 Ch 8 (transformations)", url:"https://stat110.hsites.harvard.edu/"},
        ],
        exs:[
          {q:"$X\\sim\\text{Uniform}(0,1)$. Let $Y=-\\log X$. Find the PDF of $Y$. (This is the inverse transform / inverse CDF method.)",ref:"B&H \u00a78"},
          {q:"$X\\sim\\mathcal{N}(0,1)$. Find the PDF of $Y=X^2$ from scratch using the CDF method. (The result is the $\\chi^2(1)$ distribution.)",ref:"B&H \u00a78"},
          {q:"For $\\mathbf{y}=A\\mathbf{x}$ with $A$ invertible and $\\mathbf{x}\\sim p_X(\\mathbf{x})$, show $p_Y(\\mathbf{y})=p_X(A^{-1}\\mathbf{y})|\\det(A^{-1})|$.",ref:"MML \u00a76.7"},
          {q:"If $U\\sim\\text{Uniform}(0,1)$ and $F$ is any CDF with inverse $F^{-1}$, show $X=F^{-1}(U)$ has CDF $F$.",ref:"B&H \u00a78"},
          {q:"In a normalising flow, we map $\\mathbf{z}\\sim p_Z$ via invertible $f$ to $\\mathbf{x}=f(\\mathbf{z})$. What is $p_X(\\mathbf{x})$ in terms of $p_Z$ and the Jacobian of $f$?",ref:"MML \u00a76.7"},
        ]},
    ]},
  { id:"ch7", num:7, title:"Continuous Optimization", color:"#34d399",
    tagline:"Gradient descent, Lagrange multipliers, and convexity.",
    frRef:"MML §7.4 · pp. 246–247",
    furtherReading:"Gradient descent has two classic weaknesses, each with its own literature: it ignores curvature (addressed by momentum/acceleration methods (Nesterov), conjugate gradient, and second-order/quasi-Newton methods like L-BFGS), and it struggles with non-differentiable objectives (addressed by subgradient methods, see Bertsekas). For convex optimization and duality more broadly, Boyd & Vandenberghe's Convex Optimization is the standard reference and is free online. At the scale of modern ML, stochastic gradient descent — not full-batch gradient descent — is the actual workhorse; Bottou et al. and Hazan survey the large-scale literature. The Lagrange-multiplier and duality machinery from this chapter resurfaces directly in the dual SVM derivation (Ch 12).",
    sections:[
      { id:"7.1", title:"Optimization Using Gradient Descent", pages:"227–233",
        why:"Gradient descent trains every neural network. Understanding step size, convergence, and saddle points is essential.",
        py:"## Gradient Descent from Scratch\nImplementing gradient descent directly makes the step-size/convergence trade-offs concrete -- exactly the trade-offs that optimizers like SGD and Adam manage automatically.\n\n```python\nimport numpy as np\n\nf = lambda x: x[0]**2 + 2*x[1]**2\ngrad_f = lambda x: np.array([2*x[0], 4*x[1]])\n\nx = np.array([3.0, 3.0])\nlr = 0.1\n\nfor i in range(50):\n    x = x - lr * grad_f(x)\n\nprint(x)         # converges toward [0, 0]\nprint(f(x))      # objective value -> 0\n```\n\nTry `lr = 0.6` -- the iterates start oscillating and diverging, illustrating exactly the step-size instability discussed in MML §7.1.",
        resources:[
          {name:"Karpathy \u2014 Neural net from scratch (includes GD)", url:"https://www.youtube.com/watch?v=VMj-3S1tku0"},
          {name:"Paul's Notes \u2014 Minimum and Maximum Values (practice)", url:"https://tutorial.math.lamar.edu/problems/calci/minmaxvalues.aspx"},
        ],
        exs:[
          {q:"Run 5 steps of GD on $f(x)=x^2-4x+5$ with $x_0=0$ and $\\alpha=0.3$. Compare to the true minimum.",ref:"Original"},
          {q:"For $f(x,y)=x^2+2y^2$, run 3 GD steps from $(2,1)^T$ with $\\alpha=0.1$. Write out each $(x_k,y_k)$.",ref:"Original"},
          {q:"Why can GD get stuck? Construct $f(x)=x^4-4x^2$ with two local minima. Starting from $x_0=0.1$, where does GD converge?",ref:"Original"},
          {q:"For a strongly convex function with $L$-Lipschitz gradient, GD with $\\alpha=1/L$ converges as $\\|\\mathbf{x}_k-\\mathbf{x}^*\\|^2\\leq(1-2\\mu/L)^k\\|\\mathbf{x}_0-\\mathbf{x}^*\\|^2$. What does the ratio $L/\\mu$ (condition number) tell you?",ref:"MML \u00a77.1"},
          {q:"SGD replaces the full gradient $\\nabla f=\\frac{1}{n}\\sum_i\\nabla f_i$ with a random minibatch gradient. Why does this still converge? What are the trade-offs vs. full-batch GD?",ref:"Original"},
        ]},
      { id:"7.2", title:"Constrained Optimization and Lagrange Multipliers", pages:"233–236",
        why:"SVMs use Lagrangian duality. PCA is constrained optimisation. Regularisation adds soft constraints.",
        py:"## Constrained Optimization with SciPy\n`scipy.optimize.minimize` solves constrained problems directly with the `constraints` argument -- no need to hand-derive the Lagrangian for routine problems (though doing so by hand builds the intuition SciPy uses internally).\n\n```python\nfrom scipy.optimize import minimize\nimport numpy as np\n\n# Minimize x^2 + y^2 subject to x + y = 1\nf = lambda v: v[0]**2 + v[1]**2\ncons = {'type': 'eq', 'fun': lambda v: v[0] + v[1] - 1}\n\nresult = minimize(f, x0=[0, 0], constraints=[cons])\nprint(result.x)  # [0.5, 0.5]\n\n# result.x satisfies the KKT/Lagrange conditions at convergence\n```\n\nInternally, SciPy's SLSQP solver works with a Lagrangian and KKT conditions -- exactly the theory in MML §7.2, just automated.",
        resources:[
          {name:"Paul's Notes \u2014 Lagrange Multipliers (practice)", url:"https://tutorial.math.lamar.edu/problems/calciii/lagrangemultipliers.aspx"},
          {name:"Khan Academy \u2014 The Lagrangian", url:"https://www.khanacademy.org/math/multivariable-calculus/applications-of-multivariable-derivatives/lagrange-multipliers-and-constrained-optimization/v/the-lagrangian"},
        ],
        exs:[
          {q:"Minimise $f(x,y)=x^2+y^2$ subject to $x+y=1$ using Lagrange multipliers. Verify it is a minimum.",ref:"Paul's Notes, CalcIII"},
          {q:"Maximise $f(x,y)=xy$ subject to $x+y=10$. Solve with Lagrange multipliers and verify via substitution.",ref:"Paul's Notes, CalcIII"},
          {q:"PCA maximises $\\mathbf{v}^T\\Sigma\\mathbf{v}$ subject to $\\|\\mathbf{v}\\|_2=1$. Set up the Lagrangian $\\mathcal{L}=\\mathbf{v}^T\\Sigma\\mathbf{v}-\\lambda(\\mathbf{v}^T\\mathbf{v}-1)$ and derive that $\\mathbf{v}$ must be an eigenvector of $\\Sigma$.",ref:"MML \u00a77.2"},
          {q:"Minimise $f(x,y,z)=x+y+z$ subject to $x^2+y^2+z^2=1$ using Lagrange multipliers.",ref:"Paul's Notes, CalcIII"},
          {q:"Explain the geometric interpretation of Lagrange multipliers: at the constrained optimum, $\\nabla f=\\lambda\\nabla g$. Illustrate for $f=x^2+y^2$, $g=x+y-1=0$.",ref:"Original"},
        ]},
      { id:"7.3", title:"Convex Optimization", pages:"236–246",
        why:"Convex functions have a unique global minimum. Recognising convexity guarantees gradient descent finds it.",
        py:"## Convex Optimization\nFor problems known to be convex (e.g. SVMs, Ch 12), `cvxpy` lets you state the objective and constraints declaratively and guarantees the global optimum.\n\n```python\nimport cvxpy as cp\nimport numpy as np\n\nx = cp.Variable(2)\nA = np.array([[1, 0], [0, 2]])\n\nobjective = cp.Minimize(cp.quad_form(x, A))\nconstraints = [x[0] + x[1] >= 1]\n\nproblem = cp.Problem(objective, constraints)\nproblem.solve()\n\nprint(x.value, problem.value)\n```\n\nBecause the problem is convex, `cvxpy`'s solution is *guaranteed* globally optimal -- unlike generic gradient descent, which can only promise a local optimum for non-convex objectives.",
        resources:[
          {name:"Boyd & Vandenberghe \u2014 Ch 1\u20133 (free classic textbook)", url:"https://web.stanford.edu/~boyd/cvxbook/"},
          {name:"Paul's Notes \u2014 Shape of a Graph: Concavity (practice)", url:"https://tutorial.math.lamar.edu/problems/calci/shapeofgraphptii.aspx"},
        ],
        exs:[
          {q:"Is $f(x)=x^4-4x^2+3$ convex? Check $f''(x)\\geq 0$ everywhere. Where does convexity fail?",ref:"Paul's Notes, CalcI"},
          {q:"Prove: if $f$ and $g$ are convex, then $f+g$ is convex. Use the definition $f(\\lambda x+(1-\\lambda)y)\\leq\\lambda f(x)+(1-\\lambda)f(y)$.",ref:"Boyd \u00a73.2"},
          {q:"Logistic regression minimises cross-entropy $L(\\mathbf{w})=-\\sum_i[y_i\\log\\sigma(\\mathbf{w}^T\\mathbf{x}_i)+(1-y_i)\\log(1-\\sigma(\\mathbf{w}^T\\mathbf{x}_i))]$, which is convex in $\\mathbf{w}$. What does this guarantee about training?",ref:"MML \u00a77.3"},
          {q:"Show any norm $\\|\\cdot\\|$ is convex. (Hint: use the triangle inequality and homogeneity.)",ref:"Boyd \u00a73.1"},
          {q:"A function $f$ is $\\mu$-strongly convex if $f(\\mathbf{y})\\geq f(\\mathbf{x})+\\nabla f(\\mathbf{x})^T(\\mathbf{y}-\\mathbf{x})+\\frac{\\mu}{2}\\|\\mathbf{y}-\\mathbf{x}\\|^2$. Show $f(\\mathbf{x})=\\|\\mathbf{x}\\|^2$ is 2-strongly convex. What does strong convexity guarantee about the minimum?",ref:"Boyd \u00a79.1"},
        ]},
    ]},
  { id:"ch8", num:8, title:"When Models Meet Data", color:"#fbbf24",
    tagline:"From mathematical objects to fitted models \u2014 the bridge into Part II.",
    sections:[
      { id:"8.1", title:"Data, Models, and Learning", pages:"251\u2013258",
        why:"Defines the empirical-vs-population distinction underlying every train/test split and generalisation argument in ML.",
        py:"## Train/Test Splits and the Data Matrix\nEvery \"data, models, learning\" discussion starts with the design matrix $X\\in\\mathbb{R}^{N\\times D}$ and labels $\\mathbf{y}$ -- `scikit-learn`'s `train_test_split` is the standard way to set up the train/test split this section motivates.\n\n```python\nimport numpy as np\nfrom sklearn.model_selection import train_test_split\n\nN, D = 200, 5\nX = np.random.randn(N, D)         # design matrix\ny = X @ np.array([1,-2,0,3,0]) + np.random.randn(N) * 0.1\n\nX_train, X_test, y_train, y_test = train_test_split(\n    X, y, test_size=0.2, random_state=0)\n\nprint(X_train.shape, X_test.shape)  # (160, 5) (40, 5)\n```",
        resources:[
          {name:"MML book \u00a78.1 (foundational, read first)", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Google ML Crash Course \u2014 Framing", url:"https://developers.google.com/machine-learning/crash-course"},
        ],
        exs:[
          {q:"A dataset has $N=100$ examples $\\{(\\mathbf{x}_n,y_n)\\}_{n=1}^{100}$. Write the design matrix $X\\in\\mathbb{R}^{N\\times D}$ and label vector $\\mathbf{y}\\in\\mathbb{R}^N$ for $D=3$ features. State their shapes.",ref:"MML \u00a78.1"},
          {q:"Explain the difference between a parametric model (e.g., linear regression with fixed $D$ parameters) and a non-parametric model (e.g., $k$-NN). Which one's complexity grows with $N$?",ref:"Original"},
          {q:"Why do we split data into training and test sets? If a model achieves 99\\% accuracy on training data but 60\\% on test data, what is happening, and what does this have to do with the empirical distribution vs. the true data-generating distribution?",ref:"MML \u00a78.1"},
          {q:"A model $f_\\theta(\\mathbf{x})$ has parameters $\\theta\\in\\mathbb{R}^D$. Explain what 'learning' means in terms of an optimisation problem over $\\theta$, referencing a loss function $L(\\theta)$.",ref:"Original"},
          {q:"i.i.d. (independent and identically distributed) is a core assumption for most ML theory. Give an example of a real dataset where this assumption is violated, and explain why that matters for training/test splits.",ref:"Original"},
        ]},
      { id:"8.2", title:"Empirical Risk Minimization", pages:"258\u2013265",
        why:"ERM is the unifying recipe behind almost all supervised learning: choose a hypothesis class, a loss, and minimise average loss over data.",
        py:"## Empirical Risk Minimization\nERM minimizes the average loss over the training set, $\\frac{1}{N}\\sum_n \\ell(y_n,f(\\mathbf{x}_n))$ -- this is literally the `loss` you pass to any training loop.\n\n```python\nimport numpy as np\n\ndef empirical_risk(y_true, y_pred, loss='squared'):\n    if loss == 'squared':\n        return np.mean((y_true - y_pred) ** 2)\n    elif loss == '0-1':\n        return np.mean(y_true != y_pred)\n\ny_true = np.array([1, 0, 1, 1, 0])\ny_pred = np.array([1, 1, 1, 0, 0])\n\nprint(empirical_risk(y_true, y_pred, '0-1'))      # 0-1 loss (misclassification rate)\nprint(empirical_risk(y_true.astype(float), y_pred.astype(float)))  # squared loss\n```\n\nMinimizing the 0-1 loss directly is NP-hard (non-differentiable) -- this is exactly why we use *surrogate* losses like cross-entropy or hinge loss instead.",
        resources:[
          {name:"MML book \u00a78.2", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"CS229 Lecture Notes \u2014 Supervised Learning", url:"https://cs229.stanford.edu/main_notes.pdf"},
        ],
        exs:[
          {q:"Write the empirical risk $R_{\\text{emp}}(f,X,Y)=\\frac{1}{N}\\sum_{n=1}^N \\ell(y_n,f(\\mathbf{x}_n))$ for the squared loss $\\ell(y,\\hat y)=(y-\\hat y)^2$ and a linear model $f(\\mathbf{x})=\\mathbf{w}^T\\mathbf{x}$. Expand it in terms of $X$, $\\mathbf{y}$, $\\mathbf{w}$.",ref:"MML \u00a78.2"},
          {q:"For binary classification with the 0-1 loss $\\ell(y,\\hat y)=\\mathbb{1}[y\\neq\\hat y]$, explain why this loss is hard to optimise directly (hint: think about gradients), and name one smooth surrogate loss used instead.",ref:"Original"},
          {q:"A hypothesis class $\\mathcal{H}$ that is too large (e.g., very high-degree polynomials) can drive empirical risk to zero while generalising poorly. What is this phenomenon called, and how does restricting $\\mathcal{H}$ relate to regularisation?",ref:"MML \u00a78.2"},
          {q:"Regularised ERM minimises $R_{\\text{emp}}(f)+\\lambda\\,\\Omega(f)$ where $\\Omega$ penalises model complexity. For $\\Omega(\\mathbf{w})=\\|\\mathbf{w}\\|_2^2$, what is this called, and what happens to the solution as $\\lambda\\to\\infty$?",ref:"MML \u00a78.2"},
          {q:"Explain the bias-variance tradeoff in terms of ERM: how does increasing model complexity typically affect training risk vs. test risk?",ref:"Original"},
        ]},
      { id:"8.3", title:"Parameter Estimation", pages:"265\u2013272",
        why:"Maximum likelihood and MAP estimation are the two workhorses for fitting probabilistic models \u2014 directly generalising least-squares.",
        py:"## Maximum Likelihood Estimation\nMLE finds the parameters that make the observed data most probable -- `scipy.optimize.minimize` on the negative log-likelihood is the general-purpose recipe when there's no closed form.\n\n```python\nimport numpy as np\nfrom scipy.optimize import minimize\nfrom scipy.stats import norm\n\ndata = np.random.normal(loc=3.0, scale=2.0, size=500)\n\ndef neg_log_likelihood(params):\n    mu, sigma = params\n    return -np.sum(norm.logpdf(data, mu, sigma))\n\nresult = minimize(neg_log_likelihood, x0=[0, 1], bounds=[(None,None),(1e-3,None)])\nprint(result.x)  # close to [3.0, 2.0]\n\n# For the Gaussian, MLE has a closed form too:\nprint(data.mean(), data.std())\n```",
        resources:[
          {name:"MML book \u00a78.3", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Stat 110 \u2014 MLE intuition", url:"https://stat110.hsites.harvard.edu/"},
        ],
        exs:[
          {q:"For $X_1,\\ldots,X_n\\sim\\mathcal{N}(\\mu,\\sigma^2)$ i.i.d., write the likelihood $p(\\mathbf{x}|\\mu,\\sigma^2)$ and the log-likelihood $\\log p(\\mathbf{x}|\\mu,\\sigma^2)$.",ref:"MML \u00a78.3"},
          {q:"Derive the MLE $\\hat\\mu_{\\text{MLE}}=\\frac{1}{n}\\sum_i x_i$ by setting $\\partial/\\partial\\mu \\log p(\\mathbf{x}|\\mu,\\sigma^2)=0$.",ref:"MML \u00a78.3"},
          {q:"Show that minimising squared-error loss $\\sum_i(y_i-\\mathbf{w}^T\\mathbf{x}_i)^2$ is equivalent to maximum likelihood estimation under a Gaussian noise model $y_i=\\mathbf{w}^T\\mathbf{x}_i+\\epsilon_i$, $\\epsilon_i\\sim\\mathcal{N}(0,\\sigma^2)$.",ref:"MML \u00a78.3"},
          {q:"MAP estimation maximises $p(\\theta|\\mathcal{D})\\propto p(\\mathcal{D}|\\theta)p(\\theta)$. If $p(\\theta)=\\mathcal{N}(0,\\tau^2 I)$ (a Gaussian prior on weights), show that MAP estimation is equivalent to ridge-regularised MLE. What is $\\lambda$ in terms of $\\sigma^2$ and $\\tau^2$?",ref:"MML \u00a78.3"},
          {q:"The MLE for the variance of $\\mathcal{N}(\\mu,\\sigma^2)$ is $\\hat\\sigma^2_{\\text{MLE}}=\\frac{1}{n}\\sum_i(x_i-\\hat\\mu)^2$, which is a biased estimator of $\\sigma^2$. Show $\\mathbb{E}[\\hat\\sigma^2_{\\text{MLE}}]=\\frac{n-1}{n}\\sigma^2$, and state the unbiased correction.",ref:"Original"},
        ]},
      { id:"8.4", title:"Probabilistic Modeling and Inference", pages:"272\u2013278",
        why:"Casts ML as inferring a posterior over unknowns given data \u2014 the language used to describe Bayesian regression, GMMs, and VAEs.",
        py:"## Probabilistic Models with PyMC\nProbabilistic programming languages like `pymc` let you specify a generative model declaratively and run inference (MCMC or variational) automatically -- the practical realization of MML §8.4's \"probabilistic modeling\" framework.\n\n```python\nimport pymc as pm\nimport numpy as np\n\nX = np.random.randn(100)\ny = 2 * X + 1 + np.random.randn(100) * 0.5\n\nwith pm.Model() as model:\n    w = pm.Normal('w', mu=0, sigma=10)\n    b = pm.Normal('b', mu=0, sigma=10)\n    sigma = pm.HalfNormal('sigma', sigma=1)\n\n    mu = w * X + b\n    pm.Normal('y_obs', mu=mu, sigma=sigma, observed=y)\n\n    trace = pm.sample(1000, progressbar=False)\n\nprint(trace.posterior['w'].mean().item())  # ~2.0\n```",
        resources:[
          {name:"MML book \u00a78.4", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"In a probabilistic model, we specify a joint distribution $p(\\mathbf{x},\\boldsymbol{\\theta})=p(\\mathbf{x}|\\boldsymbol{\\theta})p(\\boldsymbol{\\theta})$. Identify the likelihood and prior, and write Bayes' rule for the posterior $p(\\boldsymbol{\\theta}|\\mathbf{x})$.",ref:"MML \u00a78.4"},
          {q:"What is the difference between 'training' (parameter estimation) and 'inference' (computing a posterior over latent variables) in a probabilistic model? Give an example of each for a Gaussian mixture model.",ref:"Original"},
          {q:"The posterior predictive distribution is $p(\\mathbf{x}_{\\text{new}}|\\mathcal{D})=\\int p(\\mathbf{x}_{\\text{new}}|\\boldsymbol{\\theta})p(\\boldsymbol{\\theta}|\\mathcal{D})\\,d\\boldsymbol{\\theta}$. Explain in words what this integral represents and why it is often intractable.",ref:"MML \u00a78.4"},
          {q:"For a model with a conjugate prior, the posterior has the same form as the prior. Why is this computationally convenient for sequential (online) inference, where data arrives one point at a time?",ref:"Original"},
          {q:"Explain the difference between point estimation (e.g., MLE/MAP, returns one $\\hat{\\boldsymbol{\\theta}}$) and full Bayesian inference (returns a distribution $p(\\boldsymbol{\\theta}|\\mathcal{D})$). What extra information does the latter give you?",ref:"MML \u00a78.4"},
        ]},
      { id:"8.5", title:"Directed Graphical Models", pages:"278\u2013283",
        why:"Graphical models give a visual language for the conditional-independence structure assumed by naive Bayes, HMMs, and GMMs.",
        py:"## Directed Graphical Models\n`pgmpy` lets you build a Bayesian network's graph structure and conditional probability tables explicitly, then query marginals and conditionals via exact inference -- a direct translation of the plate-notation diagrams in this section.\n\n```python\nfrom pgmpy.models import DiscreteBayesianNetwork\nfrom pgmpy.factors.discrete import TabularCPD\nfrom pgmpy.inference import VariableElimination\n\nmodel = DiscreteBayesianNetwork([('Rain', 'Wet')])\n\ncpd_rain = TabularCPD('Rain', 2, [[0.8], [0.2]])\ncpd_wet  = TabularCPD('Wet', 2,\n    [[0.9, 0.1], [0.1, 0.9]],\n    evidence=['Rain'], evidence_card=[2])\n\nmodel.add_cpds(cpd_rain, cpd_wet)\n\ninfer = VariableElimination(model)\nprint(infer.query(['Rain'], evidence={'Wet': 1}))  # P(Rain | Wet=1)\n```",
        resources:[
          {name:"MML book \u00a78.5", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Bishop PRML \u2014 Ch 8 (Graphical Models)", url:"https://www.microsoft.com/en-us/research/uploads/prod/2006/01/Bishop-Pattern-Recognition-and-Machine-Learning-2006.pdf"},
        ],
        exs:[
          {q:"A directed graphical model represents $p(x_1,\\ldots,x_K)=\\prod_{k=1}^K p(x_k|\\text{pa}(x_k))$. For a chain $x_1\\to x_2\\to x_3$, write out the factorised joint distribution.",ref:"MML \u00a78.5"},
          {q:"Draw the graphical model for a Gaussian mixture model: a latent variable $z_n$ (cluster assignment) for each data point $x_n$, with shared parameters $\\boldsymbol{\\pi},\\{\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k\\}$. Use plate notation for $n=1,\\ldots,N$.",ref:"MML \u00a78.5"},
          {q:"In the chain $A\\to B\\to C$, show that $A$ and $C$ are conditionally independent given $B$ (i.e., $A\\perp\\!\\!\\!\\perp C \\mid B$) by writing $p(A,C|B)$ and factoring.",ref:"Original"},
          {q:"'Explaining away': for the structure $A\\to C \\leftarrow B$ (a 'collider'), $A$ and $B$ are marginally independent but become dependent once $C$ is observed. Give a real-world example of two independent causes of a shared effect, and explain the intuition.",ref:"Original"},
          {q:"Naive Bayes assumes features $x_1,\\ldots,x_D$ are conditionally independent given the class label $y$: $p(\\mathbf{x}|y)=\\prod_{d=1}^D p(x_d|y)$. Draw this as a graphical model and explain why this assumption simplifies parameter estimation.",ref:"MML \u00a78.5"},
        ]},
      { id:"8.6", title:"Model Selection", pages:"283\u2013289",
        why:"Cross-validation and information criteria let you choose between models \u2014 the practical decision every ML pipeline must make.",
        py:"## Model Selection and Cross-Validation\n$k$-fold cross-validation estimates generalization error without touching the test set -- `sklearn.model_selection.cross_val_score` is the standard tool for the model-comparison procedure this section describes.\n\n```python\nimport numpy as np\nfrom sklearn.linear_model import Ridge\nfrom sklearn.model_selection import cross_val_score\n\nX = np.random.randn(200, 5)\ny = X @ np.array([1,-2,0,3,0]) + np.random.randn(200) * 0.5\n\nfor alpha in [0.01, 1.0, 100.0]:\n    model = Ridge(alpha=alpha)\n    scores = cross_val_score(model, X, y, cv=5, scoring='r2')\n    print(alpha, scores.mean())\n```\n\nPicking the $\\alpha$ with the best *cross-validated* score (not training score) is exactly how MML §8.6 frames model selection as choosing among a family of models.",
        resources:[
          {name:"MML book \u00a78.6", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"StatQuest \u2014 Machine Learning Fundamentals: Bias and Variance", url:"https://www.youtube.com/watch?v=EuBBz3bI-aA"},
        ],
        exs:[
          {q:"Explain $k$-fold cross-validation: how is the dataset partitioned, and how is the final performance estimate computed? Why is it more reliable than a single train/test split for small datasets?",ref:"MML \u00a78.6"},
          {q:"The expected test error decomposes as $\\text{Bias}^2+\\text{Variance}+\\text{Irreducible Noise}$. As model complexity increases, how do bias and variance typically change? Sketch the resulting U-shaped test error curve.",ref:"MML \u00a78.6"},
          {q:"The Akaike Information Criterion is $\\text{AIC}=2k-2\\ln(\\hat{L})$ where $k$ is the number of parameters and $\\hat L$ is the maximised likelihood. Explain how AIC penalises model complexity, and how you would use it to compare two models.",ref:"MML \u00a78.6"},
          {q:"You have 3 candidate models with increasing polynomial degree $1, 3, 10$ fit to $N=15$ data points. The degree-10 model has the lowest training error. Explain why this alone does not mean it is the best model, and describe an experiment to find the best degree.",ref:"Original"},
          {q:"Nested cross-validation uses an outer loop for performance estimation and an inner loop for hyperparameter tuning. Explain why using the same CV loop for both hyperparameter selection and final performance reporting gives an optimistically biased estimate.",ref:"Original"},
        ]},
    ]},
  { id:"ch9", num:9, title:"Linear Regression", color:"#38bdf8",
    tagline:"Fitting lines, planes, and posteriors — the canonical worked example.",
    frRef:"MML §9.5 · pp. 315–316",
    furtherReading:"We assumed a Gaussian likelihood throughout, which gives closed-form Bayesian inference, but it's the wrong choice for binary outcomes (use a Bernoulli likelihood — this is logistic regression) or count data (Binomial/Poisson). These all fall under generalized linear models (GLMs): $y=\\sigma(f(\\mathbf{x}))$ where $f$ is linear and $\\sigma$ is a fixed nonlinearity, the 'activation function'. Stack several of these and you get a deep neural network — GLMs are literally the building blocks of feedforward nets. If instead of a distribution over parameters $\\boldsymbol{\\theta}$ you place a distribution directly over functions, you get a Gaussian process (Rasmussen & Williams), closely related to Bayesian linear regression via the kernel trick. And if your prior on $\\boldsymbol{\\theta}$ is a Laplace distribution instead of Gaussian, you get $L_1$-regularized regression — LASSO — which performs automatic variable selection by driving many parameters exactly to zero.",
    sections:[
      { id:"9.1", title:"Problem Formulation", pages:"289–292",
        why:"Sets up the probabilistic regression model $y=f(\\mathbf{x})+\\epsilon$ that every later section refines.",
        py:"## Setting Up the Regression Problem\nThe linear regression model $y=\\boldsymbol{\\phi}(\\mathbf{x})^T\\boldsymbol{\\theta}+\\epsilon$ starts with building the design matrix $\\Phi$ -- including a column of 1s for the bias/intercept term.\n\n```python\nimport numpy as np\n\nx = np.linspace(0, 10, 50)\ny = 2 * x + 1 + np.random.randn(50) * 0.5  # true theta = [1, 2]\n\n# Design matrix Phi: column of 1s (bias) + x\nPhi = np.column_stack([np.ones_like(x), x])\nprint(Phi.shape)  # (50, 2)\n```\n\nThis `Phi` is the input to every estimator below -- in scikit-learn, `fit_intercept=True` adds the bias column for you automatically.",
        resources:[
          {name:"MML book §9.1", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"The regression model is $y=f(\\mathbf{x})+\\epsilon$ with $\\epsilon\\sim\\mathcal{N}(0,\\sigma^2)$. Write the resulting likelihood $p(y|\\mathbf{x})$ and explain why it is Gaussian.",ref:"MML §9.1"},
          {q:"For linear regression $f(\\mathbf{x})=\\mathbf{x}^T\\boldsymbol{\\theta}$, write the likelihood for a full dataset $\\{(\\mathbf{x}_n,y_n)\\}_{n=1}^N$ assuming i.i.d. noise, as a product and then as a single multivariate Gaussian over $\\mathbf{y}$.",ref:"MML §9.1"},
          {q:"Why does additive Gaussian noise on $y$ make the conditional $p(y|\\mathbf{x},\\boldsymbol{\\theta})$ Gaussian with mean $\\mathbf{x}^T\\boldsymbol{\\theta}$, but the marginal $p(y)$ (over random $\\mathbf{x}$ too) need not be Gaussian?",ref:"Original"},
          {q:"Sketch why a model that is linear in the *parameters* $\\boldsymbol{\\theta}$ can still represent nonlinear functions of $\\mathbf{x}$, e.g., $f(x)=\\theta_0+\\theta_1 x+\\theta_2 x^2$. What is $\\boldsymbol{\\phi}(x)$ here?",ref:"MML §9.1"},
          {q:"Given $N=4$ observations, write the design matrix $\\Phi\\in\\mathbb{R}^{4\\times 3}$ for the feature map $\\phi(x)=(1,x,x^2)^T$ and inputs $x\\in\\{-1,0,1,2\\}$.",ref:"Original"},
        ]},
      { id:"9.2", title:"Parameter Estimation", pages:"292–303",
        why:"Derives the normal equations and MLE/MAP for linear regression — the most-used closed-form solution in ML.",
        py:"## Maximum Likelihood and Ridge Regression\nThe MLE for linear regression is ordinary least squares; adding a Gaussian prior on $\\boldsymbol{\\theta}$ gives MAP estimation, which is exactly ridge regression.\n\n```python\nimport numpy as np\nfrom sklearn.linear_model import LinearRegression, Ridge\n\nx = np.linspace(0, 10, 50).reshape(-1, 1)\ny = 2 * x.ravel() + 1 + np.random.randn(50) * 0.5\n\n# MLE = ordinary least squares\nols = LinearRegression().fit(x, y)\nprint(ols.coef_, ols.intercept_)\n\n# MAP with Gaussian prior = ridge regression\nridge = Ridge(alpha=1.0).fit(x, y)\nprint(ridge.coef_, ridge.intercept_)\n\n# Closed-form MLE: theta = (Phi^T Phi)^-1 Phi^T y\nPhi = np.column_stack([np.ones_like(x.ravel()), x.ravel()])\ntheta = np.linalg.inv(Phi.T @ Phi) @ Phi.T @ y\nprint(theta)\n```",
        resources:[
          {name:"MML book §9.2", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Strang 18.06 — Least Squares (Lec 16)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-16-projection-matrices-and-least-squares/"},
        ],
        exs:[
          {q:"Starting from the negative log-likelihood $-\\log p(\\mathbf{y}|X,\\boldsymbol{\\theta})=\\frac{1}{2\\sigma^2}\\|\\mathbf{y}-X\\boldsymbol{\\theta}\\|^2+\\text{const}$, derive the normal equations $X^TX\\hat{\\boldsymbol{\\theta}}=X^T\\mathbf{y}$ by setting the gradient to zero.",ref:"MML §9.2"},
          {q:"Fit $y=\\theta_0+\\theta_1 x$ to the points $(0,1),(1,2),(2,2)$ using the normal equations. Compute $\\hat{\\boldsymbol{\\theta}}$ explicitly.",ref:"Original"},
          {q:"For the ridge-regularised objective $\\|\\mathbf{y}-X\\boldsymbol{\\theta}\\|^2+\\lambda\\|\\boldsymbol{\\theta}\\|^2$, derive $\\hat{\\boldsymbol{\\theta}}=(X^TX+\\lambda I)^{-1}X^T\\mathbf{y}$. Why is $X^TX+\\lambda I$ guaranteed invertible even when $X^TX$ is not?",ref:"MML §9.2"},
          {q:"Explain why MLE for linear regression can overfit when $D$ (number of features) is close to or exceeds $N$ (number of data points), and how the MAP/ridge estimate addresses this.",ref:"MML §9.2"},
          {q:"For the noise-variance MLE in linear regression, $\\hat\\sigma^2=\\frac{1}{N}\\|\\mathbf{y}-X\\hat{\\boldsymbol{\\theta}}\\|^2$, explain in words what this quantity measures and how it relates to the residuals from §3.6 (orthogonal projections).",ref:"Original"},
        ]},
      { id:"9.3", title:"Bayesian Linear Regression", pages:"303–313",
        why:"Produces a full posterior over weights — giving predictive uncertainty, not just point predictions, used in Bayesian optimisation and active learning.",
        py:"## Bayesian Linear Regression\nBayesian linear regression returns a *posterior distribution* over $\\boldsymbol{\\theta}$ (and hence predictive uncertainty), not just a point estimate -- `scikit-learn`'s `BayesianRidge` implements exactly this.\n\n```python\nimport numpy as np\nfrom sklearn.linear_model import BayesianRidge\n\nx = np.linspace(0, 10, 30).reshape(-1, 1)\ny = 2 * x.ravel() + 1 + np.random.randn(30) * 0.5\n\nmodel = BayesianRidge().fit(x, y)\n\nx_new = np.array([[11.0]])\nmean, std = model.predict(x_new, return_std=True)\nprint(mean, std)  # predictive mean AND uncertainty\n```\n\nThe `return_std=True` output is the key difference from ordinary regression -- it's the posterior predictive variance, growing as you extrapolate away from the training data.",
        resources:[
          {name:"MML book §9.3", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Bishop PRML §3.3 — Bayesian Linear Regression", url:"https://www.microsoft.com/en-us/research/uploads/prod/2006/01/Bishop-Pattern-Recognition-and-Machine-Learning-2006.pdf"},
        ],
        exs:[
          {q:"With prior $p(\\boldsymbol{\\theta})=\\mathcal{N}(\\mathbf{0},\\alpha^2 I)$ and Gaussian likelihood, write Bayes' rule for the posterior $p(\\boldsymbol{\\theta}|X,\\mathbf{y})$ and state (without deriving) that it is also Gaussian — what property of the prior/likelihood pair guarantees this?",ref:"MML §9.3"},
          {q:"The posterior mean for Bayesian linear regression is $\\boldsymbol{\\mu}_{\\text{post}}=\\sigma^{-2}\\Sigma_{\\text{post}}X^T\\mathbf{y}$ with $\\Sigma_{\\text{post}}=(\\sigma^{-2}X^TX+\\alpha^{-2}I)^{-1}$. Show this matches the ridge-regression estimate from §9.2 in the limit, and identify how $\\lambda$ relates to $\\sigma^2/\\alpha^2$.",ref:"MML §9.3"},
          {q:"As $N\\to\\infty$ (more data), what happens to the posterior covariance $\\Sigma_{\\text{post}}$? Explain intuitively why more data should make us more certain about $\\boldsymbol{\\theta}$.",ref:"Original"},
          {q:"The posterior predictive distribution at a new point $\\mathbf{x}_*$ is $p(y_*|\\mathbf{x}_*,X,\\mathbf{y})=\\mathcal{N}(\\mathbf{x}_*^T\\boldsymbol{\\mu}_{\\text{post}},\\ \\mathbf{x}_*^T\\Sigma_{\\text{post}}\\mathbf{x}_*+\\sigma^2)$. Explain the two sources of uncertainty in this variance.",ref:"MML §9.3"},
          {q:"For a 1D feature $\\phi(x)=(1,x)^T$ and a small dataset, sketch (in words) how the predictive uncertainty $\\mathbf{x}_*^T\\Sigma_{\\text{post}}\\mathbf{x}_*$ behaves for $x_*$ far from the training data compared to within the training range. Why does this matter for extrapolation?",ref:"Original"},
        ]},
      { id:"9.4", title:"Maximum Likelihood as Orthogonal Projection", pages:"313–315",
        why:"Closes the loop with §3.8: the least-squares fit $\\hat{\\mathbf{y}}=X\\hat{\\boldsymbol{\\theta}}$ is literally the orthogonal projection of $\\mathbf{y}$ onto $\\text{col}(X)$.",
        py:"## Maximum Likelihood as Orthogonal Projection\nGeometrically, OLS finds $\\hat{\\mathbf{y}}=\\Phi\\hat{\\boldsymbol{\\theta}}$ as the *orthogonal projection* of $\\mathbf{y}$ onto the column space of $\\Phi$ -- the same projection formula from §3.8.\n\n```python\nimport numpy as np\n\nx = np.linspace(0, 10, 50)\ny = 2 * x + 1 + np.random.randn(50) * 0.5\nPhi = np.column_stack([np.ones_like(x), x])\n\n# Projection onto col(Phi)\nP = Phi @ np.linalg.inv(Phi.T @ Phi) @ Phi.T\ny_hat = P @ y\n\n# Residual is orthogonal to col(Phi)\nresidual = y - y_hat\nprint(np.allclose(Phi.T @ residual, 0, atol=1e-8))  # True\n```\n\nThe fact that the residual is orthogonal to every column of $\\Phi$ is precisely the normal-equations condition $\\Phi^T(\\mathbf{y}-\\Phi\\hat{\\boldsymbol{\\theta}})=\\mathbf{0}$.",
        resources:[
          {name:"MML book §9.4", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Strang 18.06 — Projections (Lec 15)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-15-projections-onto-subspaces/"},
        ],
        exs:[
          {q:"Show that $\\hat{\\mathbf{y}}=X(X^TX)^{-1}X^T\\mathbf{y}=P\\mathbf{y}$ where $P$ is the projection matrix from §3.8. Why does this mean $\\hat{\\mathbf{y}}\\in\\text{col}(X)$?",ref:"MML §9.4"},
          {q:"For $X=\\begin{pmatrix}1&0\\\\1&1\\\\1&2\\end{pmatrix}$ and $\\mathbf{y}=(6,0,0)^T$, compute $\\hat{\\boldsymbol{\\theta}}$, the fitted values $\\hat{\\mathbf{y}}$, and the residual $\\mathbf{e}=\\mathbf{y}-\\hat{\\mathbf{y}}$. Verify $\\mathbf{e}\\perp\\text{col}(X)$.",ref:"Original"},
          {q:"If the columns of $X$ were orthonormal (i.e., $X^TX=I$), what would $\\hat{\\boldsymbol{\\theta}}$ simplify to? Interpret each component $\\hat\\theta_i$ as an inner product.",ref:"MML §9.4"},
          {q:"Explain geometrically why adding a feature column to $X$ (increasing $\\dim(\\text{col}(X))$) can never increase the residual norm $\\|\\mathbf{e}\\|$ — and why this is exactly the reason raw training error is a poor model-selection criterion (link to §8.6).",ref:"Original"},
          {q:"For simple linear regression $y=\\theta_0+\\theta_1 x$, show that the fitted line always passes through the point $(\\bar x,\\bar y)$ (the means of $x$ and $y$). (Hint: use the normal equations with the all-ones column of $X$.)",ref:"Original"},
        ]},
    ]},
  { id:"ch10", num:10, title:"Dimensionality Reduction with PCA", color:"#fb7185",
    tagline:"Compressing data while keeping what matters — eigenvectors made practical.",
    frRef:"MML §10.8 · pp. 343–344",
    furtherReading:"PCA can be viewed through a third lens beyond variance-maximization and projection-error-minimization: as a linear auto-encoder. The encoder $B^T$ compresses $\\mathbf{x}\\in\\mathbb{R}^D$ to a code $\\mathbf{z}\\in\\mathbb{R}^M$, and the decoder $B$ reconstructs $\\tilde{\\mathbf{x}}=B\\mathbf{z}$; minimizing the average reconstruction error $\\|\\mathbf{x}-\\tilde{\\mathbf{x}}\\|^2$ recovers exactly the same solution as the projection-perspective derivation. Replace the linear encoder/decoder with deep neural networks and you get a (nonlinear) deep auto-encoder — the encoder is sometimes called a 'recognition network' and the decoder a 'generator', terminology that carries directly into VAEs. There's also an information-theoretic reading: PCA can be derived as maximizing the mutual information between the data and its compressed code. For estimating the PPCA parameters $B,\\boldsymbol{\\mu},\\sigma^2$ themselves via maximum likelihood, see Tipping & Bishop (1999).",
    sections:[
      { id:"10.1", title:"Problem Setting", pages:"318–320",
        why:"Frames PCA as finding a low-dimensional subspace that retains most of the data's variance — the starting point for compression and visualisation.",
        py:"## Centering and Standardizing Data\nPCA assumes centered data (zero mean) -- `sklearn.preprocessing.StandardScaler` centers (and optionally scales) each feature, the standard preprocessing step before any PCA call.\n\n```python\nimport numpy as np\nfrom sklearn.preprocessing import StandardScaler\n\nX = np.random.randn(100, 5) * np.array([10,1,1,5,1]) + 3\n\nscaler = StandardScaler(with_std=False)  # center only\nX_centered = scaler.fit_transform(X)\n\nprint(X_centered.mean(axis=0))  # ~0 for every feature\n```\n\nIf features are on very different scales, also divide by the standard deviation (`with_std=True`) -- otherwise PCA will be dominated by whichever feature has the largest variance, regardless of its actual importance.",
        resources:[
          {name:"MML book §10.1", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"3Blue1Brown — Essence of PCA (via eigenvectors)", url:"https://www.youtube.com/watch?v=PFDu9oVAE-g"},
        ],
        exs:[
          {q:"Given centred data $\\mathbf{x}_n\\in\\mathbb{R}^D$ (i.e., $\\frac{1}{N}\\sum_n\\mathbf{x}_n=\\mathbf{0}$), write the empirical covariance matrix $S=\\frac{1}{N}\\sum_{n=1}^N \\mathbf{x}_n\\mathbf{x}_n^T$. What is its shape, and why must it be symmetric and positive semi-definite?",ref:"MML §10.1"},
          {q:"Why do we centre the data (subtract the mean) before applying PCA? What would happen to the principal directions if we skipped this step for data far from the origin?",ref:"MML §10.1"},
          {q:"PCA seeks a $M$-dimensional subspace ($M<D$) that minimises information loss. State two equivalent ways to formalise 'information loss': (1) in terms of variance retained, (2) in terms of reconstruction error. (You'll derive both formally in §10.2–10.3.)",ref:"MML §10.1"},
          {q:"For a dataset with $D=1000$ features (e.g., pixel values) and $N=200$ samples, why is computing the $D\\times D$ covariance matrix $S$ potentially problematic, and what does this hint about an alternative computational route?",ref:"MML §10.5"},
          {q:"If all the variance in a 3D dataset lies in a 2D plane through the origin, what would you expect the third eigenvalue of the covariance matrix $S$ to be? What does this tell you about the intrinsic dimensionality of the data?",ref:"Original"},
        ]},
      { id:"10.2", title:"Maximum Variance Perspective", pages:"320–325",
        why:"Derives PCA as 'find the direction of maximum spread' — directly connects to §7.2's Lagrange-multiplier argument that principal directions are eigenvectors of $S$.",
        py:"## Maximum Variance via Eigendecomposition\nThe directions of maximum variance are the eigenvectors of the data covariance matrix, ordered by eigenvalue -- this is PCA's defining computation, before any library wrapper.\n\n```python\nimport numpy as np\n\nX = np.random.randn(200, 3) @ np.array([[3,1,0],[1,2,0],[0,0,0.1]])\nX = X - X.mean(axis=0)  # center\n\nS = np.cov(X.T)                       # covariance matrix\neigvals, eigvecs = np.linalg.eigh(S)  # ascending order\n\n# Sort descending: top eigenvector = direction of max variance\norder = np.argsort(eigvals)[::-1]\nprint(eigvals[order])\nprint(eigvecs[:, order[0]])  # first principal component direction\n```",
        resources:[
          {name:"MML book §10.2", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Strang 18.06 — Symmetric Matrices (Lec 25)", url:"https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/resources/lecture-25-symmetric-matrices-and-positive-definiteness/"},
        ],
        exs:[
          {q:"For a unit vector $\\mathbf{b}_1$ ($\\|\\mathbf{b}_1\\|=1$), the variance of the projected data is $V_1=\\mathbf{b}_1^TS\\mathbf{b}_1$. Set up the constrained optimisation $\\max_{\\mathbf{b}_1} \\mathbf{b}_1^TS\\mathbf{b}_1$ s.t. $\\|\\mathbf{b}_1\\|^2=1$ using a Lagrange multiplier (recall §7.2).",ref:"MML §10.2"},
          {q:"Show that the stationary condition from the Lagrangian in the previous exercise gives $S\\mathbf{b}_1=\\lambda_1\\mathbf{b}_1$ — i.e., $\\mathbf{b}_1$ must be an eigenvector of $S$. Which eigenvector (largest or smallest $\\lambda$) maximises the variance, and why?",ref:"MML §10.2"},
          {q:"For $S=\\begin{pmatrix}3&1\\\\1&3\\end{pmatrix}$, find the eigenvalues and eigenvectors. Which eigenvector is the first principal component $\\mathbf{b}_1$, and what fraction of the total variance ($\\text{tr}(S)$) does it explain?",ref:"Original"},
          {q:"The $M$-th principal component $\\mathbf{b}_M$ is found by maximising variance subject to $\\|\\mathbf{b}_M\\|=1$ AND $\\mathbf{b}_M\\perp\\mathbf{b}_1,\\ldots,\\mathbf{b}_{M-1}$. Why is the orthogonality constraint necessary — what would go wrong without it?",ref:"MML §10.2"},
          {q:"Define the 'explained variance ratio' for the first $M$ components as $\\frac{\\sum_{i=1}^M\\lambda_i}{\\sum_{i=1}^D\\lambda_i}$. For eigenvalues $5,3,1,1$, compute the explained variance ratio for $M=1$ and $M=2$.",ref:"Original"},
        ]},
      { id:"10.3", title:"Projection Perspective", pages:"325–333",
        why:"Reconstructs PCA as minimum-reconstruction-error orthogonal projection — the same machinery as §3.8, now applied to a learned subspace.",
        py:"## PCA as Projection onto a Subspace\nReducing to $M$ dimensions means projecting onto the subspace spanned by the top $M$ eigenvectors -- `sklearn.decomposition.PCA` wraps exactly this projection.\n\n```python\nimport numpy as np\nfrom sklearn.decomposition import PCA\n\nX = np.random.randn(200, 5)\n\npca = PCA(n_components=2)\nZ = pca.fit_transform(X)       # projected (low-dim) representation\nX_reconstructed = pca.inverse_transform(Z)  # back to original space\n\nprint(Z.shape)                          # (200, 2)\nprint(pca.explained_variance_ratio_)    # variance captured per component\nprint(np.linalg.norm(X - X_reconstructed))  # reconstruction error\n```",
        resources:[
          {name:"MML book §10.3", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"For an ONB $B=(\\mathbf{b}_1,\\ldots,\\mathbf{b}_M)$ of an $M$-dimensional subspace $U$, the projection of $\\mathbf{x}_n$ onto $U$ is $\\tilde{\\mathbf{x}}_n=\\sum_{m=1}^M(\\mathbf{b}_m^T\\mathbf{x}_n)\\mathbf{b}_m$. Write the average reconstruction error $J_M=\\frac{1}{N}\\sum_{n=1}^N\\|\\mathbf{x}_n-\\tilde{\\mathbf{x}}_n\\|^2$.",ref:"MML §10.3"},
          {q:"Show that minimising the reconstruction error $J_M$ over orthonormal $\\{\\mathbf{b}_m\\}$ is equivalent to maximising the retained variance $\\sum_{m=1}^M\\mathbf{b}_m^TS\\mathbf{b}_m$. (Hint: use $\\|\\mathbf{x}_n\\|^2=\\|\\tilde{\\mathbf{x}}_n\\|^2+\\|\\mathbf{x}_n-\\tilde{\\mathbf{x}}_n\\|^2$, a Pythagorean identity from §3.4.)",ref:"MML §10.3"},
          {q:"Show that the minimum reconstruction error using $M$ principal components is $J_M=\\sum_{j=M+1}^D\\lambda_j$ — the sum of the *discarded* eigenvalues.",ref:"MML §10.3"},
          {q:"For eigenvalues $\\lambda=(8,4,2,1)$ of $S\\in\\mathbb{R}^{4\\times4}$, compute the minimum reconstruction error $J_M$ for $M=1,2,3$.",ref:"Original"},
          {q:"Connect §10.3 to §4.6 (Matrix Approximation): explain why PCA's solution $\\hat X=\\sum_{i=1}^M(\\mathbf{u}_i^T\\mathbf{x})\\mathbf{u}_i$ for centred data is exactly the Eckart-Young best rank-$M$ approximation of the data matrix.",ref:"MML §10.2/§4.6"},
        ]},
      { id:"10.4", title:"Eigenvector Computation and Low-Rank Approximations", pages:"333–335",
        why:"Connects PCA directly to the SVD of the data matrix — the algorithm actually used in practice (never compute $S$ explicitly for large $D$).",
        py:"## Eigenvector Computation via SVD\nIn practice, PCA is computed via SVD of the (centered) data matrix, not by forming the covariance matrix explicitly -- more numerically stable, and what `sklearn.decomposition.PCA` does under the hood.\n\n```python\nimport numpy as np\n\nX = np.random.randn(200, 5)\nXc = X - X.mean(axis=0)\n\nU, S, Vt = np.linalg.svd(Xc, full_matrices=False)\n\n# Principal components = rows of Vt (= eigenvectors of covariance)\n# Singular values relate to eigenvalues by: eigval_i = S_i^2 / (n-1)\neigvals_from_svd = S**2 / (X.shape[0] - 1)\nprint(eigvals_from_svd)\n\n# Low-rank approximation, keeping top k components\nk = 2\nX_approx = U[:, :k] @ np.diag(S[:k]) @ Vt[:k, :]\n```",
        resources:[
          {name:"MML book §10.4", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Visual Kernel — SVD Visualized", url:"https://www.youtube.com/watch?v=vSczTbgc8Rc"},
        ],
        exs:[
          {q:"For centred data matrix $X\\in\\mathbb{R}^{N\\times D}$ (rows = samples), the covariance is $S=\\frac{1}{N}X^TX$. If $X=U\\Sigma V^T$ is the SVD of $X$, express $S$ in terms of $V$, $\\Sigma$, and $N$. What do the columns of $V$ represent?",ref:"MML §10.4"},
          {q:"Show that the eigenvalues of $S=\\frac{1}{N}X^TX$ are $\\lambda_i=\\sigma_i^2/N$ where $\\sigma_i$ are the singular values of $X$, and that the eigenvectors of $S$ are the right singular vectors $\\mathbf{v}_i$.",ref:"MML §10.4"},
          {q:"Why is computing the SVD of $X$ directly preferable to forming $S=\\frac{1}{N}X^TX$ and eigendecomposing it, in terms of (a) computational cost and (b) numerical stability (recall the condition number from §4.5)?",ref:"MML §10.4"},
          {q:"The rank-$M$ PCA reconstruction of $X$ is $\\hat X=U_M\\Sigma_M V_M^T$ (truncated SVD). If $X\\in\\mathbb{R}^{1000\\times 50}$ and $M=5$, compare the storage cost of $\\hat X$ stored as $U_M,\\Sigma_M,V_M$ vs. the full $1000\\times 50$ matrix.",ref:"Original"},
          {q:"In practice, scikit-learn's PCA computes the SVD of the centred data matrix rather than eigendecomposing the covariance matrix. Given your answers above, explain why this is the right engineering choice.",ref:"Original"},
        ]},
      { id:"10.5", title:"PCA in High Dimensions", pages:"335–336",
        why:"The 'kernel trick for PCA': when $D\\gg N$ (e.g., images), compute eigenvectors of an $N\\times N$ matrix instead of $D\\times D$.",
        py:"## PCA in High Dimensions\nWhen $D \\gg N$ (more features than samples, e.g. images or genomics), forming the $D\\times D$ covariance matrix is infeasible -- instead, work with the $N\\times N$ Gram matrix $XX^T$, whose nonzero eigenvalues match those of $X^TX$.\n\n```python\nimport numpy as np\n\nN, D = 50, 5000  # far more dimensions than samples\nX = np.random.randn(N, D)\nXc = X - X.mean(axis=0)\n\n# N x N Gram matrix instead of D x D covariance\nG = Xc @ Xc.T / (N - 1)\nprint(G.shape)  # (50, 50) -- tractable!\n\neigvals, eigvecs_small = np.linalg.eigh(G)\n\n# Map eigenvectors back to D-dimensional space\norder = np.argsort(eigvals)[::-1][:2]\npcs = Xc.T @ eigvecs_small[:, order]\npcs /= np.linalg.norm(pcs, axis=0)\nprint(pcs.shape)  # (5000, 2)\n```",
        resources:[
          {name:"MML book §10.5 (short, focused reading)", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"For centred $X\\in\\mathbb{R}^{N\\times D}$ with $D\\gg N$, the covariance $S=\\frac{1}{N}X^TX\\in\\mathbb{R}^{D\\times D}$ is huge but has rank $\\leq N$. Explain why $S$ can have at most $N$ non-zero eigenvalues.",ref:"MML §10.5"},
          {q:"Define $K=\\frac{1}{N}XX^T\\in\\mathbb{R}^{N\\times N}$. If $K\\mathbf{c}_i=\\lambda_i\\mathbf{c}_i$, show that $\\mathbf{b}_i=X^T\\mathbf{c}_i$ is an eigenvector of $S=\\frac{1}{N}X^TX$ with the same eigenvalue $\\lambda_i$ (up to normalisation).",ref:"MML §10.5"},
          {q:"For $N=100$ images of $D=10000$ pixels each, compare the cost of eigendecomposing $S$ ($10000\\times 10000$) vs. $K$ ($100\\times 100$). Roughly how many times smaller is the second computation (eigendecomposition is $O(n^3)$)?",ref:"Original"},
          {q:"After computing eigenvectors $\\mathbf{c}_i$ of $K$, the corresponding (unnormalised) eigenvector of $S$ is $\\mathbf{b}_i=X^T\\mathbf{c}_i$. Why must $\\mathbf{b}_i$ be normalised to unit length before being used as a principal direction?",ref:"MML §10.5"},
          {q:"This trick — working with an $N\\times N$ Gram-like matrix instead of a $D\\times D$ covariance — reappears in §3.7 and §12.4 (kernels). What is the common structural feature that makes it possible in all three cases?",ref:"Original"},
        ]},
      { id:"10.6", title:"Key Steps of PCA in Practice", pages:"336–339",
        why:"The full PCA recipe end-to-end — standardisation, eigendecomposition, projection, reconstruction — as you'd actually implement it.",
        py:"## A Practical PCA Pipeline\nThe standard recipe -- center, (optionally scale), decompose, choose $M$ via explained variance, project -- maps directly onto a `scikit-learn` `Pipeline`.\n\n```python\nimport numpy as np\nfrom sklearn.pipeline import Pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.decomposition import PCA\n\nX = np.random.randn(300, 10)\n\npipe = Pipeline([\n    ('scale', StandardScaler()),\n    ('pca', PCA(n_components=0.95)),  # keep 95% of variance\n])\n\nZ = pipe.fit_transform(X)\nprint(Z.shape)  # number of components chosen automatically\n\npca = pipe.named_steps['pca']\nprint(np.cumsum(pca.explained_variance_ratio_))\n```\n\n`n_components=0.95` automatically picks the smallest $M$ such that the top $M$ components explain 95% of the variance -- the practical version of \"choosing $M$\" discussed in this section.",
        resources:[
          {name:"MML book §10.6", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"scikit-learn — PCA user guide", url:"https://scikit-learn.org/stable/modules/decomposition.html#pca"},
        ],
        exs:[
          {q:"List the steps of PCA in order: (1) mean-centre, (2) optionally standardise to unit variance, (3) compute covariance/SVD, (4) ... Explain what step (2) does and when it is important (hint: think about features measured in different units).",ref:"MML §10.6"},
          {q:"Given centred data points $(1,2),(3,4),(5,4),(7,6)$ in $\\mathbb{R}^2$, compute the $2\\times 2$ covariance matrix $S$ (you may leave the mean-subtraction implicit if already centred — otherwise centre first).",ref:"Original"},
          {q:"After projecting data onto the top $M$ principal components to get $\\mathbf{z}_n=B^T\\mathbf{x}_n\\in\\mathbb{R}^M$, write the formula to reconstruct an approximation $\\hat{\\mathbf{x}}_n\\in\\mathbb{R}^D$ from $\\mathbf{z}_n$.",ref:"MML §10.6"},
          {q:"A common heuristic is to choose $M$ such that the cumulative explained variance ratio exceeds 95\\%. For eigenvalues $10,4,2,1,1,0.5,0.5$, find the smallest $M$ satisfying this.",ref:"Original"},
          {q:"PCA assumes the data is well-described by a *linear* subspace. Describe a dataset shape (e.g., points on a curved manifold) where PCA would perform poorly, and name one nonlinear alternative (no derivation needed).",ref:"Original"},
        ]},
      { id:"10.7", title:"Latent Variable Perspective", pages:"339–343",
        why:"Reframes PCA as a generative probabilistic model (PPCA) — the bridge to factor analysis, GMMs (Ch 11), and VAEs.",
        py:"## Probabilistic PCA (Latent Variable View)\nProbabilistic PCA treats PCA as a latent-variable model $\\mathbf{x}=W\\mathbf{z}+\\boldsymbol{\\mu}+\\boldsymbol{\\epsilon}$ -- `sklearn.decomposition.FactorAnalysis` (with isotropic noise) implements this generative view, and it reduces to standard PCA as the noise variance goes to zero.\n\n```python\nimport numpy as np\nfrom sklearn.decomposition import FactorAnalysis, PCA\n\nX = np.random.randn(200, 5)\n\nfa = FactorAnalysis(n_components=2).fit(X)\nZ = fa.transform(X)  # latent representation z\n\nprint(fa.components_.shape)  # W^T: (2, 5)\n\n# Compare to standard PCA\npca = PCA(n_components=2).fit(X)\nprint(pca.components_.shape)\n```\n\nUnlike PCA, probabilistic PCA gives you a generative model -- you can sample new $\\mathbf{x}$'s from $p(\\mathbf{x})=\\int p(\\mathbf{x}|\\mathbf{z})p(\\mathbf{z})\\,d\\mathbf{z}$, useful for density estimation and missing-data imputation.",
        resources:[
          {name:"MML book §10.7", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Bishop PRML §12.2 — Probabilistic PCA", url:"https://www.microsoft.com/en-us/research/uploads/prod/2006/01/Bishop-Pattern-Recognition-and-Machine-Learning-2006.pdf"},
        ],
        exs:[
          {q:"Probabilistic PCA (PPCA) defines a generative model: $\\mathbf{z}\\sim\\mathcal{N}(\\mathbf{0},I)$, $\\mathbf{x}=B\\mathbf{z}+\\boldsymbol{\\mu}+\\boldsymbol{\\epsilon}$ with $\\boldsymbol{\\epsilon}\\sim\\mathcal{N}(\\mathbf{0},\\sigma^2 I)$. Write the resulting marginal distribution $p(\\mathbf{x})$ and its covariance in terms of $B$ and $\\sigma^2$.",ref:"MML §10.7"},
          {q:"In the limit $\\sigma^2\\to 0$, explain why PPCA's maximum-likelihood solution for $B$ recovers standard PCA (the span of $B$ becomes the top-$M$ eigenvectors of $S$).",ref:"MML §10.7"},
          {q:"What extra capability does PPCA have over standard PCA, owing to being a full probabilistic model? (Think: can it handle missing data, generate new samples, give a likelihood for model comparison?)",ref:"MML §10.7"},
          {q:"The latent variable $\\mathbf{z}\\in\\mathbb{R}^M$ has a posterior $p(\\mathbf{z}|\\mathbf{x})$ given the observed $\\mathbf{x}$. Why is this posterior Gaussian, and what does computing it correspond to (in relation to §10.3's projection)?",ref:"MML §10.7"},
          {q:"Compare PPCA to a Gaussian Mixture Model (Ch 11) at a high level: both are latent-variable models with a Gaussian likelihood. What is fundamentally different about the latent variable $\\mathbf{z}$ in each (continuous vs. discrete, dimensionality)?",ref:"Original"},
        ]},
    ]},
  { id:"ch11", num:11, title:"Density Estimation with Gaussian Mixture Models", color:"#a3e635",
    tagline:"Soft clustering as a sum of Gaussians, fit by Expectation-Maximization.",
    frRef:"MML §11.5 · pp. 368–369",
    furtherReading:"GMMs are generative models — sample a new point by first picking a component $k$ according to $\\pi_k$, then sampling $\\mathbf{x}\\sim\\mathcal{N}(\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k)$. K-means is essentially a special case: fix all covariances to $I$ and replace the 'soft' responsibilities with a 'hard' nearest-centroid assignment. The EM algorithm derived here for GMMs generalizes to parameter learning in any latent-variable model — nonlinear state-space models and some reinforcement-learning algorithms use the exact same idea. Maximum likelihood for GMMs has real failure modes worth knowing about: a component can collapse onto a single data point, sending its likelihood to infinity, and MLE gives no sense of parameter uncertainty (a fully Bayesian treatment would need variational inference, since there's no conjugate prior here). Outside of mixture models, histograms and kernel density estimation are the two classic nonparametric alternatives for density estimation.",
    sections:[
      { id:"11.1", title:"Gaussian Mixture Model", pages:"349–350",
        why:"Defines the model used for soft clustering, density estimation, and as a building block for HMMs and speaker recognition systems.",
        py:"## Setting Up a Gaussian Mixture\nA GMM is a weighted sum of $K$ Gaussians, $p(\\mathbf{x})=\\sum_{k=1}^K\\pi_k\\mathcal{N}(\\mathbf{x}|\\boldsymbol{\\mu}_k,\\Sigma_k)$ -- you can evaluate and plot this density directly before fitting it to data.\n\n```python\nimport numpy as np\nfrom scipy.stats import multivariate_normal\n\n# A 2-component 1D mixture\npis = [0.3, 0.7]\nmus = [-2, 3]\nsigmas = [1.0, 1.5]\n\ndef gmm_pdf(x):\n    return sum(p * multivariate_normal(m, s**2).pdf(x)\n               for p, m, s in zip(pis, mus, sigmas))\n\nx = np.linspace(-6, 8, 100)\ndensity = gmm_pdf(x)\nprint(density.sum() * (x[1]-x[0]))  # ~1.0 (integrates to 1)\n```",
        resources:[
          {name:"MML book §11.1", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"3Blue1Brown — Bayes (refresher for mixture weights)", url:"https://www.youtube.com/watch?v=HZGCoVF3YvM"},
        ],
        exs:[
          {q:"A GMM defines $p(\\mathbf{x})=\\sum_{k=1}^K \\pi_k\\,\\mathcal{N}(\\mathbf{x}|\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k)$. State the constraints on the mixture weights $\\pi_k$ and explain why they are necessary for $p(\\mathbf{x})$ to be a valid density.",ref:"MML §11.1"},
          {q:"For $K=2$ with $\\pi_1=0.3,\\pi_2=0.7$, $\\mu_1=-2,\\mu_2=3$, $\\sigma_1=\\sigma_2=1$ (1D Gaussians), sketch the shape of $p(x)$ — is it unimodal or bimodal? At roughly what $x$ would you expect a local minimum (if any)?",ref:"Original"},
          {q:"Contrast a GMM with a single Gaussian $\\mathcal{N}(\\boldsymbol{\\mu},\\boldsymbol{\\Sigma})$: why can a GMM model multimodal data while a single Gaussian cannot, regardless of $\\boldsymbol{\\Sigma}$?",ref:"Original"},
          {q:"For $K=3$ components in $\\mathbb{R}^2$ with full covariance matrices, count the total number of free parameters (means, covariances, and mixture weights), accounting for the constraint $\\sum_k\\pi_k=1$ and symmetry of $\\boldsymbol{\\Sigma}_k$.",ref:"MML §11.1"},
          {q:"Introduce a discrete latent variable $z\\in\\{1,\\ldots,K\\}$ with $p(z=k)=\\pi_k$ and $p(\\mathbf{x}|z=k)=\\mathcal{N}(\\mathbf{x}|\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k)$. Show that marginalising out $z$ (sum rule from §6.3) recovers the GMM density $p(\\mathbf{x})=\\sum_k\\pi_k\\mathcal{N}(\\mathbf{x}|\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k)$.",ref:"MML §11.1"},
        ]},
      { id:"11.2", title:"Parameter Learning via Maximum Likelihood", pages:"350–360",
        why:"Shows why GMM log-likelihood has no closed-form maximiser (unlike §8.3's Gaussian MLE) — motivating the EM algorithm.",
        py:"## Fitting a GMM with Maximum Likelihood\n`sklearn.mixture.GaussianMixture` fits $\\pi_k,\\boldsymbol{\\mu}_k,\\Sigma_k$ via EM under the hood -- maximizing exactly the log-likelihood derived in this section.\n\n```python\nimport numpy as np\nfrom sklearn.mixture import GaussianMixture\n\nrng = np.random.default_rng(0)\nX = np.concatenate([\n    rng.normal(-2, 1, size=(300, 1)),\n    rng.normal(3, 1.5, size=(700, 1)),\n])\n\ngmm = GaussianMixture(n_components=2, random_state=0).fit(X)\n\nprint(gmm.weights_)   # estimated pi_k\nprint(gmm.means_)     # estimated mu_k\nprint(gmm.covariances_)\nprint(gmm.score(X))   # average log-likelihood per sample\n```",
        resources:[
          {name:"MML book §11.2", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"CS229 Notes — Mixtures of Gaussians and EM", url:"https://cs229.stanford.edu/main_notes.pdf"},
        ],
        exs:[
          {q:"Write the log-likelihood $\\log p(X|\\boldsymbol{\\theta})=\\sum_{n=1}^N\\log\\left(\\sum_{k=1}^K\\pi_k\\mathcal{N}(\\mathbf{x}_n|\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k)\\right)$ for a GMM. Why does the sum *inside* the log (over $k$) make $\\partial/\\partial\\boldsymbol{\\mu}_k=0$ not yield a closed-form solution, unlike the single-Gaussian case in §8.3?",ref:"MML §11.2"},
          {q:"Define the *responsibility* $r_{nk}=\\dfrac{\\pi_k\\mathcal{N}(\\mathbf{x}_n|\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k)}{\\sum_{j=1}^K\\pi_j\\mathcal{N}(\\mathbf{x}_n|\\boldsymbol{\\mu}_j,\\boldsymbol{\\Sigma}_j)}$. Show $\\sum_{k=1}^K r_{nk}=1$ for each $n$, and interpret $r_{nk}$ as $p(z_n=k|\\mathbf{x}_n)$.",ref:"MML §11.2"},
          {q:"Setting $\\partial/\\partial\\boldsymbol{\\mu}_k=0$ gives $\\hat{\\boldsymbol{\\mu}}_k=\\frac{1}{N_k}\\sum_{n=1}^N r_{nk}\\mathbf{x}_n$ where $N_k=\\sum_n r_{nk}$. Explain why this is a 'responsibility-weighted mean', and why it depends on $r_{nk}$, which itself depends on $\\boldsymbol{\\mu}_k$ — creating a circular dependency.",ref:"MML §11.2"},
          {q:"The optimal mixture weight is $\\hat\\pi_k=N_k/N$. Interpret $N_k$ as the 'effective number of points' assigned to cluster $k$, and explain why $\\sum_k N_k=N$.",ref:"MML §11.2"},
          {q:"For two clusters with hard assignments ($r_{nk}\\in\\{0,1\\}$, i.e., $k$-means style), the formulas for $\\hat{\\boldsymbol{\\mu}}_k$ reduce to ordinary cluster means. Explain how soft responsibilities $r_{nk}\\in[0,1]$ generalise this, and what advantage soft assignment gives near cluster boundaries.",ref:"Original"},
        ]},
      { id:"11.3", title:"EM Algorithm", pages:"360–363",
        why:"The Expectation-Maximization algorithm — alternating E and M steps to climb the likelihood — used far beyond GMMs (HMMs, missing data imputation).",
        py:"## The EM Algorithm\nEM alternates an E-step (compute responsibilities $r_{nk}$) and an M-step (update $\\pi_k,\\boldsymbol{\\mu}_k,\\Sigma_k$ given those responsibilities) -- here it is from scratch for a 1D, 2-component GMM.\n\n```python\nimport numpy as np\nfrom scipy.stats import norm\n\nX = np.concatenate([np.random.normal(-2,1,300), np.random.normal(3,1.5,700)])\npis, mus, sigmas = [0.5,0.5], [0.0,1.0], [1.0,1.0]\n\nfor it in range(50):\n    # E-step: responsibilities\n    r = np.array([p*norm.pdf(X,m,s) for p,m,s in zip(pis,mus,sigmas)])\n    r /= r.sum(axis=0)\n\n    # M-step: update parameters\n    Nk = r.sum(axis=1)\n    mus = (r @ X) / Nk\n    sigmas = np.sqrt((r * (X - mus[:,None])**2).sum(axis=1) / Nk)\n    pis = Nk / len(X)\n\nprint(pis, mus, sigmas)\n```\n\nEach EM iteration provably increases (never decreases) the log-likelihood -- a useful invariant to assert when debugging your own implementation.",
        resources:[
          {name:"MML book §11.3", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Victor Lavrenko — Visualizing the EM Algorithm", url:"https://www.youtube.com/watch?v=XLKoTqGao7U"},
        ],
        exs:[
          {q:"State the EM algorithm for GMMs in two steps: (E-step) compute $r_{nk}$ for all $n,k$ given current $\\boldsymbol{\\theta}$; (M-step) update $\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k,\\pi_k$ given $r_{nk}$. Why must these alternate rather than being solved simultaneously?",ref:"MML §11.3"},
          {q:"Run one E-step by hand: for $K=2$ equally-weighted 1D Gaussians $\\mathcal{N}(0,1)$ and $\\mathcal{N}(4,1)$, compute the responsibilities $r_{n1},r_{n2}$ for a data point $x_n=2$.",ref:"Original"},
          {q:"EM is guaranteed to never decrease the log-likelihood at each iteration, but is not guaranteed to find the global maximum. Explain why GMM likelihood is non-convex, and describe one practical strategy to mitigate poor local optima (e.g., multiple restarts).",ref:"MML §11.3"},
          {q:"What happens to a GMM's log-likelihood if one component's covariance $\\boldsymbol{\\Sigma}_k\\to\\mathbf{0}$ while $\\boldsymbol{\\mu}_k$ sits exactly on a data point (a 'degenerate' solution)? Why is this a known pathology of MLE for GMMs, and how is it typically handled?",ref:"MML §11.3"},
          {q:"For initialisation, $k$-means is often run first to get initial cluster assignments, which seed $\\boldsymbol{\\mu}_k$ for EM. Explain the relationship between $k$-means and a GMM with equal, isotropic, shared covariances $\\boldsymbol{\\Sigma}_k=\\sigma^2 I$ in the limit $\\sigma^2\\to 0$.",ref:"Original"},
        ]},
      { id:"11.4", title:"Latent-Variable Perspective", pages:"363–368",
        why:"Reformulates GMM/EM via the latent indicator $z_n$ and a variational lower bound (ELBO) — the same machinery underlying VAEs.",
        py:"## Sampling from the Latent-Variable View\nA GMM as a latent-variable model means: first sample a discrete latent $z\\sim\\text{Cat}(\\boldsymbol{\\pi})$ choosing a component, then sample $\\mathbf{x}\\sim\\mathcal{N}(\\boldsymbol{\\mu}_z,\\Sigma_z)$ -- this generative process is exactly `GaussianMixture.sample`.\n\n```python\nimport numpy as np\nfrom sklearn.mixture import GaussianMixture\n\ngmm = GaussianMixture(n_components=2, random_state=0)\ngmm.weights_ = np.array([0.3, 0.7])\ngmm.means_ = np.array([[-2.0],[3.0]])\ngmm.covariances_ = np.array([[[1.0]],[[1.5**2]]])\ngmm.precisions_cholesky_ = np.linalg.cholesky(np.linalg.inv(gmm.covariances_))\n\nX, z = gmm.sample(1000)  # X: data, z: which component generated each point\nprint(np.bincount(z) / 1000)  # approx [0.3, 0.7]\n\n# Posterior over z given x (the \"responsibilities\")\nresp = gmm.predict_proba(X[:5])\nprint(resp)\n```",
        resources:[
          {name:"MML book §11.4", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Bishop PRML §9.4 — EM as a general algorithm", url:"https://www.microsoft.com/en-us/research/uploads/prod/2006/01/Bishop-Pattern-Recognition-and-Machine-Learning-2006.pdf"},
        ],
        exs:[
          {q:"With latent $z_n\\in\\{1,\\ldots,K\\}$ (one-hot encoded as $\\mathbf{z}_n\\in\\{0,1\\}^K$), write the *complete-data* log-likelihood $\\log p(X,Z|\\boldsymbol{\\theta})=\\sum_n\\sum_k z_{nk}\\log(\\pi_k\\mathcal{N}(\\mathbf{x}_n|\\boldsymbol{\\mu}_k,\\boldsymbol{\\Sigma}_k))$. Why is this easier to optimise than the marginal log-likelihood from §11.2 (no log-of-sum)?",ref:"MML §11.4"},
          {q:"The E-step computes $\\mathbb{E}_{Z|X,\\boldsymbol{\\theta}^{\\text{old}}}[\\log p(X,Z|\\boldsymbol{\\theta})]$ — i.e., replaces $z_{nk}$ with its expectation $r_{nk}=\\mathbb{E}[z_{nk}|\\mathbf{x}_n]$. Why does $\\mathbb{E}[z_{nk}]=p(z_{nk}=1|\\mathbf{x}_n)=r_{nk}$ for a binary indicator?",ref:"MML §11.4"},
          {q:"The Evidence Lower Bound (ELBO) satisfies $\\log p(X|\\boldsymbol{\\theta})\\geq\\text{ELBO}(\\boldsymbol{\\theta},q)$ for any distribution $q(Z)$. Explain in words why maximising the ELBO is a tractable proxy for maximising the (intractable) marginal log-likelihood.",ref:"MML §11.4"},
          {q:"In the E-step, $q(Z)$ is set to the true posterior $p(Z|X,\\boldsymbol{\\theta}^{\\text{old}})$, which makes the ELBO bound *tight* (equal to the log-likelihood at $\\boldsymbol{\\theta}^{\\text{old}}$). Explain why this guarantees the M-step cannot decrease the true log-likelihood.",ref:"MML §11.4"},
          {q:"VAEs replace the discrete $z_n\\in\\{1,\\ldots,K\\}$ with a continuous latent $\\mathbf{z}\\in\\mathbb{R}^M$ and the exact posterior $p(z|\\mathbf{x})$ with a learned approximation $q_\\phi(\\mathbf{z}|\\mathbf{x})$ (a neural network). What role does the ELBO from this section play in training a VAE?",ref:"Original"},
        ]},
    ]},
  { id:"ch12", num:12, title:"Classification with Support Vector Machines", color:"#2dd4bf",
    tagline:"Maximum-margin hyperplanes, duality, and the kernel trick.",
    frRef:"MML §12.6 · pp. 392–394",
    furtherReading:"The SVM is one of many binary classifiers — others include the perceptron, logistic regression, Fisher's discriminant, k-nearest neighbors, naive Bayes, and random forests (Bishop; Murphy), and SVMs are tightly linked to the empirical risk minimization framework from Chapter 8. For a deep dive into kernels and kernel methods specifically, Schölkopf & Smola and Shawe-Taylor & Cristianini are the standard references; an alternative derivation of the dual SVM goes via the Legendre-Fenchel transform (§7.3.3) instead of Lagrange duality. One practical gap: the SVM's raw output is just a real-valued score, not a calibrated probability — Platt scaling and related calibration methods convert this score into $P(y=1|\\mathbf{x})$ when you need probabilistic outputs rather than a hard $\\{+1,-1\\}$ decision.",
    sections:[
      { id:"12.1", title:"Separating Hyperplanes", pages:"372–374",
        why:"Defines the geometric object — a hyperplane $\\mathbf{w}^T\\mathbf{x}+b=0$ — that every linear classifier (logistic regression, SVM, perceptron) is built around.",
        py:"## Visualizing a Separating Hyperplane\nA hyperplane $\\{\\mathbf{x}:\\mathbf{w}^T\\mathbf{x}+b=0\\}$ separates two classes when $\\mathbf{w}^T\\mathbf{x}_n+b$ has the sign of $y_n$ for every point -- easy to check directly with NumPy before any solver is involved.\n\n```python\nimport numpy as np\n\n# Two linearly separable clusters\nX = np.vstack([np.random.randn(20,2)+[2,2], np.random.randn(20,2)+[-2,-2]])\ny = np.array([1]*20 + [-1]*20)\n\nw, b = np.array([1.0, 1.0]), 0.0  # a candidate hyperplane\n\nmargins = y * (X @ w + b)\nprint(np.all(margins > 0))  # True if w, b separate the classes\n```\n\nEvery point with $y_n(\\mathbf{w}^T\\mathbf{x}_n+b) > 0$ is correctly classified -- the *value* of this margin is what the SVM objective in §12.2 maximizes.",
        resources:[
          {name:"MML book §12.1", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"3Blue1Brown — Vectors recap (dot products & hyperplanes)", url:"https://www.youtube.com/watch?v=fNk_zzaMoSs"},
        ],
        exs:[
          {q:"A hyperplane in $\\mathbb{R}^2$ is $\\{\\mathbf{x}:\\mathbf{w}^T\\mathbf{x}+b=0\\}$. For $\\mathbf{w}=(1,1)^T$, $b=-2$, sketch the line and identify which side satisfies $\\mathbf{w}^T\\mathbf{x}+b>0$.",ref:"MML §12.1"},
          {q:"Show that $\\mathbf{w}$ is orthogonal to the hyperplane $\\{\\mathbf{x}:\\mathbf{w}^T\\mathbf{x}+b=0\\}$. (Hint: take two points $\\mathbf{x}_1,\\mathbf{x}_2$ on the hyperplane and consider $\\mathbf{w}^T(\\mathbf{x}_1-\\mathbf{x}_2)$.)",ref:"MML §12.1"},
          {q:"The signed distance from a point $\\mathbf{x}_0$ to the hyperplane $\\mathbf{w}^T\\mathbf{x}+b=0$ is $\\dfrac{\\mathbf{w}^T\\mathbf{x}_0+b}{\\|\\mathbf{w}\\|}$. Compute this for $\\mathbf{x}_0=(3,3)^T$, $\\mathbf{w}=(1,1)^T$, $b=-2$. (Recall projections from §3.8.)",ref:"MML §12.1"},
          {q:"A binary classifier predicts $\\hat y=\\text{sign}(\\mathbf{w}^T\\mathbf{x}+b)$. Explain why scaling $(\\mathbf{w},b)\\to(c\\mathbf{w},cb)$ for $c>0$ does not change the classifier's predictions, but does change the signed distance formula above.",ref:"Original"},
          {q:"Given two linearly separable classes, are there infinitely many separating hyperplanes, finitely many, or exactly one? What additional criterion (covered in §12.2) would you use to pick a single 'best' one?",ref:"MML §12.1"},
        ]},
      { id:"12.2", title:"Primal Support Vector Machine", pages:"374–383",
        why:"Derives the maximum-margin classifier as a constrained optimisation problem — directly using the Lagrange-multiplier and convexity machinery from §7.2–7.3.",
        py:"## The Primal SVM with scikit-learn\n`sklearn.svm.SVC(kernel='linear')` solves the primal soft-margin SVM, $\\min_{\\mathbf{w},b}\\frac{1}{2}\\|\\mathbf{w}\\|^2+C\\sum_n\\xi_n$ -- the $C$ parameter directly controls the margin/violation trade-off from this section.\n\n```python\nimport numpy as np\nfrom sklearn.svm import SVC\n\nX = np.vstack([np.random.randn(20,2)+[2,2], np.random.randn(20,2)+[-2,-2]])\ny = np.array([1]*20 + [-1]*20)\n\nclf = SVC(kernel='linear', C=1.0).fit(X, y)\n\nprint(clf.coef_, clf.intercept_)   # w, b\nprint(clf.support_vectors_.shape)  # points with nonzero alpha (slack)\n```\n\nA small `C` allows more margin violations (wider margin, more bias); a large `C` penalizes violations heavily (narrower margin, can overfit) -- try both and compare `clf.support_vectors_`.",
        resources:[
          {name:"MML book §12.2", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"StatQuest — Support Vector Machines (Part 1)", url:"https://www.youtube.com/watch?v=efR1C6CvhmE"},
        ],
        exs:[
          {q:"The hard-margin SVM maximises the margin $\\frac{2}{\\|\\mathbf{w}\\|}$ subject to $y_n(\\mathbf{w}^T\\mathbf{x}_n+b)\\geq 1$ for all $n$. Show this is equivalent to minimising $\\frac{1}{2}\\|\\mathbf{w}\\|^2$ subject to the same constraints. Why is the squared norm preferred over $\\|\\mathbf{w}\\|$ for optimisation?",ref:"MML §12.2"},
          {q:"Verify that the objective $\\frac{1}{2}\\|\\mathbf{w}\\|^2$ is convex (recall §7.3). Why does this guarantee the hard-margin SVM has a unique global optimum (when the data is separable)?",ref:"MML §12.2"},
          {q:"Real data is rarely perfectly separable. The soft-margin SVM introduces slack variables $\\xi_n\\geq 0$ and minimises $\\frac{1}{2}\\|\\mathbf{w}\\|^2+C\\sum_n\\xi_n$ subject to $y_n(\\mathbf{w}^T\\mathbf{x}_n+b)\\geq 1-\\xi_n$. Explain the role of $\\xi_n$ and what happens as $C\\to\\infty$.",ref:"MML §12.2"},
          {q:"For a fixed $\\mathbf{w}$, $b$, a point with $y_n(\\mathbf{w}^T\\mathbf{x}_n+b)\\geq 1$ has $\\xi_n=0$ at the optimum. Explain why, given the objective minimises $\\sum_n\\xi_n$ and the constraint only requires $\\xi_n\\geq\\max(0,1-y_n(\\mathbf{w}^T\\mathbf{x}_n+b))$.",ref:"Original"},
          {q:"The soft-margin SVM loss can be written unconstrained as $\\frac{1}{2}\\|\\mathbf{w}\\|^2+C\\sum_n\\max(0,1-y_n(\\mathbf{w}^T\\mathbf{x}_n+b))$. Identify the 'hinge loss' term and explain how the parameter $C$ trades off margin width against misclassification.",ref:"MML §12.2"},
        ]},
      { id:"12.3", title:"Dual Support Vector Machine", pages:"383–388",
        why:"The dual formulation reveals 'support vectors' and is the form that enables the kernel trick — central to non-linear SVMs.",
        py:"## The Dual SVM and Lagrange Multipliers\nThe dual problem optimizes Lagrange multipliers $\\alpha_n\\geq 0$ directly; `clf.dual_coef_` exposes $\\alpha_n y_n$ for the support vectors -- the same quantities derived via the Lagrangian in this section.\n\n```python\nimport numpy as np\nfrom sklearn.svm import SVC\n\nX = np.vstack([np.random.randn(20,2)+[2,2], np.random.randn(20,2)+[-2,-2]])\ny = np.array([1]*20 + [-1]*20)\n\nclf = SVC(kernel='linear', C=1.0).fit(X, y)\n\nalpha_y = clf.dual_coef_           # alpha_n * y_n for support vectors\nsv = clf.support_vectors_\n\n# Reconstruct w from the dual solution: w = sum_n alpha_n y_n x_n\nw_from_dual = (alpha_y @ sv).ravel()\nprint(w_from_dual, clf.coef_)      # should match\n```\n\nOnly points with $\\alpha_n>0$ (the support vectors) influence $\\mathbf{w}$ -- this sparsity is the practical payoff of solving the dual.",
        resources:[
          {name:"MML book §12.3", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Boyd & Vandenberghe — Ch 5 (Duality)", url:"https://web.stanford.edu/~boyd/cvxbook/"},
        ],
        exs:[
          {q:"Form the Lagrangian $\\mathcal{L}(\\mathbf{w},b,\\boldsymbol{\\alpha})=\\frac{1}{2}\\|\\mathbf{w}\\|^2-\\sum_n\\alpha_n[y_n(\\mathbf{w}^T\\mathbf{x}_n+b)-1]$ with multipliers $\\alpha_n\\geq 0$ for the hard-margin SVM (recall §7.2 for the constrained-optimisation setup).",ref:"MML §12.3"},
          {q:"Setting $\\partial\\mathcal{L}/\\partial\\mathbf{w}=\\mathbf{0}$ gives $\\mathbf{w}=\\sum_n\\alpha_n y_n\\mathbf{x}_n$. Substitute this back into $\\mathcal{L}$ and show the dual objective depends only on inner products $\\mathbf{x}_n^T\\mathbf{x}_m$.",ref:"MML §12.3"},
          {q:"The dual problem is $\\max_{\\boldsymbol{\\alpha}}\\sum_n\\alpha_n-\\frac{1}{2}\\sum_{n,m}\\alpha_n\\alpha_m y_n y_m\\mathbf{x}_n^T\\mathbf{x}_m$ subject to $\\alpha_n\\geq 0$ and $\\sum_n\\alpha_n y_n=0$. Why is this a quadratic program in $\\boldsymbol{\\alpha}$?",ref:"MML §12.3"},
          {q:"At the optimum, the KKT complementary slackness condition gives $\\alpha_n[y_n(\\mathbf{w}^T\\mathbf{x}_n+b)-1]=0$. Explain why this means $\\alpha_n=0$ for points strictly outside the margin, and $\\alpha_n>0$ only for 'support vectors' on the margin.",ref:"MML §12.3"},
          {q:"Since $\\mathbf{w}=\\sum_n\\alpha_n y_n\\mathbf{x}_n$ and only support vectors have $\\alpha_n>0$, explain why the SVM decision boundary depends only on the support vectors — not on the full dataset. What practical advantage does this give for large datasets?",ref:"Original"},
        ]},
      { id:"12.4", title:"Kernels", pages:"388–390",
        why:"Replacing $\\mathbf{x}_n^T\\mathbf{x}_m$ with $k(\\mathbf{x}_n,\\mathbf{x}_m)$ turns a linear SVM into a non-linear classifier without ever computing high-dimensional features — directly extends §3.7.",
        py:"## Kernels: the Kernel Trick in Practice\nSwitching `kernel='linear'` to `kernel='rbf'` (or `'poly'`) implicitly maps data into a higher-dimensional feature space and computes inner products there via $k(\\mathbf{x},\\mathbf{x}')$ -- without ever forming the feature map explicitly.\n\n```python\nimport numpy as np\nfrom sklearn.svm import SVC\nfrom sklearn.datasets import make_circles\n\n# Data that is NOT linearly separable\nX, y = make_circles(n_samples=100, noise=0.05, factor=0.4, random_state=0)\n\nlinear = SVC(kernel='linear').fit(X, y)\nrbf = SVC(kernel='rbf', gamma='scale').fit(X, y)\n\nprint(linear.score(X, y))  # poor -- no linear separator exists\nprint(rbf.score(X, y))     # near-perfect -- RBF kernel separates the circles\n```\n\nThe RBF kernel $k(\\mathbf{x},\\mathbf{x}')=\\exp(-\\gamma\\|\\mathbf{x}-\\mathbf{x}'\\|^2)$ corresponds to an infinite-dimensional feature map -- yet `SVC` never computes it directly, only the kernel values.",
        resources:[
          {name:"MML book §12.4", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"MML book §3.7 — Inner Product of Functions (refresher)", url:"https://mml-book.github.io/book/mml-book.pdf"},
        ],
        exs:[
          {q:"Because the dual SVM objective (§12.3) depends only on $\\mathbf{x}_n^T\\mathbf{x}_m$, we can replace it with $k(\\mathbf{x}_n,\\mathbf{x}_m)=\\phi(\\mathbf{x}_n)^T\\phi(\\mathbf{x}_m)$ for some feature map $\\phi$. Recall from §3.7 the feature map for $k(\\mathbf{x},\\mathbf{x}')=(\\mathbf{x}^T\\mathbf{x}'+1)^2$ — what is its dimensionality for $\\mathbf{x}\\in\\mathbb{R}^2$?",ref:"MML §12.4 / §3.7"},
          {q:"For the RBF (Gaussian) kernel $k(\\mathbf{x},\\mathbf{x}')=\\exp(-\\|\\mathbf{x}-\\mathbf{x}'\\|^2/(2\\gamma^2))$, the implicit feature space $\\phi(\\mathbf{x})$ is infinite-dimensional. Explain why the kernel trick still makes this computationally feasible.",ref:"MML §12.4"},
          {q:"Mercer's condition requires a valid kernel's Gram matrix $K_{nm}=k(\\mathbf{x}_n,\\mathbf{x}_m)$ to be symmetric positive semi-definite for any dataset. Connect this to §4.3 (Cholesky/PD matrices) — why does PSD-ness guarantee $k$ corresponds to a real inner product $\\phi(\\mathbf{x})^T\\phi(\\mathbf{x}')$?",ref:"MML §12.4"},
          {q:"With the RBF kernel, what does the hyperparameter $\\gamma$ control intuitively (decision boundary smoothness vs. flexibility)? What happens to the decision boundary as $\\gamma\\to 0$ and as $\\gamma\\to\\infty$?",ref:"Original"},
          {q:"Once trained, the SVM decision function is $f(\\mathbf{x})=\\sum_{n\\in SV}\\alpha_n y_n k(\\mathbf{x}_n,\\mathbf{x})+b$. Explain why prediction cost scales with the number of support vectors rather than the original feature dimensionality.",ref:"MML §12.4"},
        ]},
      { id:"12.5", title:"Numerical Solution", pages:"390–392",
        why:"Connects SVM training back to the optimisation toolbox of Ch 7 — quadratic programming, and why SVMs don't have a closed-form solution like linear regression.",
        py:"## Numerical Solution: Quadratic Programming\nSVM training is a quadratic program (QP); `cvxpy` lets you write the dual QP from §12.3 directly and confirms `sklearn`'s solution numerically.\n\n```python\nimport cvxpy as cp\nimport numpy as np\n\nX = np.vstack([np.random.randn(10,2)+[2,2], np.random.randn(10,2)+[-2,-2]])\ny = np.array([1.0]*10 + [-1.0]*10)\nn = len(y)\n\nK = X @ X.T  # linear kernel (Gram matrix)\nalpha = cp.Variable(n)\n\nobjective = cp.Maximize(cp.sum(alpha) - 0.5*cp.quad_form(cp.multiply(alpha,y), K))\nconstraints = [alpha >= 0, alpha <= 1.0, cp.sum(cp.multiply(alpha,y)) == 0]\n\nprob = cp.Problem(objective, constraints)\nprob.solve()\n\nprint(alpha.value.round(3))  # nonzero entries = support vectors\n```\n\n`SVC` uses specialized QP solvers (SMO) for speed at scale, but the optimization problem they solve is exactly this dual QP.",
        resources:[
          {name:"MML book §12.5", url:"https://mml-book.github.io/book/mml-book.pdf"},
          {name:"Platt (1998) — Sequential Minimal Optimization (SMO)", url:"https://www.microsoft.com/en-us/research/publication/sequential-minimal-optimization-a-fast-algorithm-for-training-support-vector-machines/"},
        ],
        exs:[
          {q:"Both the primal (§12.2) and dual (§12.3) SVM problems are quadratic programs (QPs): minimise a quadratic objective subject to linear constraints. Why does convexity (§7.3) guarantee that any local solution found is global?",ref:"MML §12.5"},
          {q:"The dual QP has $N$ variables ($\\alpha_1,\\ldots,\\alpha_N$, one per training point), while the primal has $D+1$ variables ($\\mathbf{w}\\in\\mathbb{R}^D$, $b$). For a dataset with $N=10^5$ points and $D=20$ features, which formulation has fewer variables — and does this change once a kernel is used?",ref:"Original"},
          {q:"Sequential Minimal Optimization (SMO) updates two $\\alpha_n$'s at a time (the minimum needed to satisfy $\\sum_n\\alpha_n y_n=0$) rather than all $N$ at once. Why must at least two be updated together?",ref:"MML §12.5"},
          {q:"Generic QP solvers scale poorly to $N>10^4$ because the kernel (Gram) matrix $K\\in\\mathbb{R}^{N\\times N}$ must be stored. Roughly how much memory does $K$ require for $N=50000$ in double precision (8 bytes)?",ref:"Original"},
          {q:"Gradient-descent-based solvers (recall §7.1) can also train SVMs by directly minimising the unconstrained hinge-loss objective from §12.2. Compare this to QP-based dual solvers in terms of scalability to large $N$ vs. exactness of the solution.",ref:"Original"},
        ]},
    ]},
];


export default function MMLPlanner() {
  useEffect(() => {
    const id = "mml-gf";
    if (!document.getElementById(id)) {
      const l = document.createElement("link");
      l.id = id; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Lora:wght@600;700&family=JetBrains+Mono:wght@400;500&family=Inter:wght@300;400;500;600&display=swap";
      document.head.appendChild(l);
    }
  }, []);

  // Global polish: scrollbars, hover/focus states, and subtle animations.
  // Lives outside inline styles since :hover/:focus/keyframes can't be expressed there.
  useEffect(() => {
    const id = "mml-polish";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      button { appearance: none; -webkit-appearance: none; font-family: inherit; }
      *::-webkit-scrollbar { width: 10px; height: 10px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { background: #3a414c; border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
      *::-webkit-scrollbar-thumb:hover { background: #4a525e; background-clip: content-box; }
      * { scrollbar-color: #3a414c transparent; scrollbar-width: thin; }
      html, body, #root { background: #1a1d21; margin: 0; }
      ::selection { background: rgba(88,166,255,0.35); }
      .mml-nav-item { transition: background-color .15s ease; }
      .mml-nav-item:hover { background: rgba(255,255,255,0.045) !important; }
      .mml-nav-item:hover .mml-badge { transform: scale(1.12); }
      .mml-card { transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; }
      .mml-card:hover { border-color: var(--accent) !important; transform: translateY(-2px); }
      .mml-chevron { transition: transform .25s ease; display: inline-block; }
      .mml-btn { transition: filter .15s ease, transform .08s ease; }
      .mml-btn:hover { filter: brightness(1.15); }
      .mml-btn:active { transform: scale(0.96); }
      .mml-link { transition: opacity .15s ease; }
      .mml-link:hover { opacity: 0.7; text-decoration: underline !important; }
      .mml-textarea { transition: border-color .15s ease, box-shadow .15s ease; }
      .mml-textarea:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(255,255,255,0.06); }
      .mml-textarea::placeholder { color: #6e7681; }
      @keyframes mml-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      .mml-reveal { animation: mml-fade-in .22s ease; }
      @keyframes mml-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
      .mml-pulse { animation: mml-pulse 1.4s ease-in-out infinite; }
      @keyframes mml-pop { 0% { transform: scale(0.85); } 55% { transform: scale(1.08); } 100% { transform: scale(1); } }
      .mml-pop { animation: mml-pop .35s cubic-bezier(.34,1.56,.64,1); }
    `;
    document.head.appendChild(s);
  }, []);

  const k = useKatex();
  const T = ({ children }) => <Tex k={k}>{children}</Tex>;

  const [selCh,    setSelCh]    = useState(0);
  const [openSec,  setOpenSec]  = useState(null);
  const [done,     setDone]     = useState({});
  const [answers,  setAnswers]  = useState({});
  const [explanations, setExplanations] = useState({});
  const [explLoading,  setExplLoading]  = useState({});
  const [hints,        setHints]        = useState({});   // secId -> [{hint1,hint2,answer}, ...]
  const [hintsLoading, setHintsLoading] = useState({});    // secId -> bool
  const [reveal,        setReveal]      = useState({});    // `${secId}-${ei}` -> 0|1|2|3

  // Progress is per-browser (localStorage), not server-side — so multiple visitors
  // sharing this deployment don't clobber each other's completed-section state.
  // The generated explanations/hints cache stays server-side and shared, since that's
  // content, not personal progress.
  useEffect(() => {
    try { const raw = localStorage.getItem("mml-done"); if (raw) setDone(JSON.parse(raw)); }
    catch(_) {}
  }, []);

  // Lazy-load cached explanation + hints when a section is opened
  async function openSection(secId) {
    const next = openSec === secId ? null : secId;
    setOpenSec(next);
    if (next && !explanations[next]) {
      try {
        const r = await storage.get(`expl5-${next}`);
        if (r) setExplanations(p => ({ ...p, [next]: r.value }));
      } catch(_) {}
    }
    if (next && !hints[next]) {
      try {
        const r = await storage.get(`hints5-${next}`);
        if (r) setHints(p => ({ ...p, [next]: JSON.parse(r.value) }));
      } catch(_) {}
    }
  }

  // Toggles one field (h1/h2/ans) independently — clicking an already-open one closes it.
  function toggleReveal(secId, exIdx, field) {
    const key = `${secId}-${exIdx}`;
    setReveal(p => ({ ...p, [key]: { ...p[key], [field]: !p[key]?.[field] } }));
  }

  async function fetchHints(sec) {
    setHintsLoading(p => ({ ...p, [sec.id]: true }));
    const exList = sec.exs.map((e, i) => `${i+1}. ${e.q}`).join("\n");
    const sys = `You are a friendly math TA creating self-study aids for exercises from 'Mathematics for Machine Learning'. For each exercise listed below, produce exactly three things:
1. HINT 1: a gentle nudge (1 sentence) that helps the student start thinking in the right direction, WITHOUT revealing the method or formula to use.
2. HINT 2: a stronger hint (1-2 sentences) that names the specific technique, theorem, or formula needed, but does not work the problem.
3. ANSWER: a complete, step-by-step worked solution ending in the final result. Show the key algebraic/computational steps, not just the final number. Be thorough but concise.

FORMATTING:
- Every math expression must be inside $...$ (inline) or $$...$$ (display, single line, no literal line breaks inside it).
- Never use $ for money/prices.
- Tone: friendly and encouraging — this is a self-study hint, not a lecture.

Output ONLY in this exact format, with no extra commentary before or after, and no markdown code fences:

===EXERCISE 1===
HINT 1: <text>
HINT 2: <text>
ANSWER:
<text>

===EXERCISE 2===
HINT 1: <text>
HINT 2: <text>
ANSWER:
<text>

(repeat for every exercise listed, in order, exactly once each)`;
    const userMsg = `Section: §${sec.id} "${sec.title}"\n\nExercises:\n${exList}`;
    try {
      const data = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_tokens: 4000, system: sys, messages: [{ role: "user", content: userMsg }] })
      }).then(r => r.json());
      const text = data.content?.map(b => b.text).filter(Boolean).join("");
      const blocks = (text || "").split(/===\s*EXERCISE\s*\d+\s*===/i).map(b => b.trim()).filter(Boolean);
      const parsed = blocks.length === sec.exs.length ? blocks.map(b => {
        const h1 = b.match(/HINT\s*1:\s*([\s\S]*?)\n\s*HINT\s*2:/i);
        const h2 = b.match(/HINT\s*2:\s*([\s\S]*?)\n\s*ANSWER:/i);
        const ans = b.match(/ANSWER:\s*([\s\S]*)/i);
        return { hint1: h1?.[1]?.trim() || "", hint2: h2?.[1]?.trim() || "", answer: ans?.[1]?.trim() || "" };
      }) : null;
      if (parsed) {
        setHints(p => ({ ...p, [sec.id]: parsed }));
        try { await storage.set(`hints5-${sec.id}`, JSON.stringify(parsed)); } catch(_) {}
      }
    } catch(_) {
    } finally {
      setHintsLoading(p => ({ ...p, [sec.id]: false }));
    }
  }

  async function fetchExpl(sec, ch) {
    setExplLoading(p => ({ ...p, [sec.id]: true }));
    setExplanations(p => ({ ...p, [sec.id]: null }));

    const topic = `§${sec.id}: "${sec.title}" — ${ch.title} (pp. ${sec.pages})`;
    const exList = sec.exs.map((e, i) => `${i+1}. ${e.q}`).join("\n");

    const FMT = `FORMATTING (violations break the renderer):
- Every math expression, even a single variable, must be inside $...$ (inline) or $$...$$ (display).
- Each $$...$$ block must be written on a SINGLE line — no literal line breaks inside it. For multi-row environments (aligned, cases, pmatrix, etc.), use \\\\ for row breaks but keep the whole $$...$$ block on one line of text. Put a blank line before and after each $$...$$ block.
- NEVER use $ for money/prices. Write "10 units" or "costs 3" — never $10.
- Never write bare LaTeX like x^2 outside dollar signs.
- Use ## for main section headers, ### for sub-headers within a section.
- Write **bold** for key terms at first use.
- Tone: friendly and clear, like a knowledgeable friend — not a dry textbook.
- Be as long as needed to be complete and clear — don't pad, but don't truncate. End with a complete sentence — never mid-sentence or mid-equation.`;

    const sys = `You are writing a complete, self-contained math lesson. ${FMT}

Write exactly these sections, in this order:

## The Big Idea
One paragraph, plain English, no equations. An analogy. Why does this concept exist and what problem does it solve?

## The Formal Toolkit
Every definition, theorem, and formula the student needs — nothing omitted. For each item: state it with math notation, then immediately explain every symbol in plain English. If there is a standard procedure (elimination, Gram-Schmidt, etc.) write it as a numbered step-by-step algorithm. Be complete — cover everything needed to solve the exercises below.

## Example 1 — Simple
The easiest possible case with small whole numbers. Every step with a brief narration of what is happening.

## Example 2 — Core Technique
A medium example using the main method. Every step narrated. End with what the result means.

## Example 3 — Tricky Case
A harder example exposing a subtlety or edge case. Every step narrated. Explain what makes this case different.

## Common Pitfalls
Exactly 3 mistakes. Format each as:
❌ **Wrong:** [what students do wrong]
✓ **Right:** [the correct approach]

## Why ML Cares
One specific ML algorithm, the formula where this topic appears, why it matters. Keep this tight — 2–3 sentences.

## Going Deeper *(optional)*
For the curious student. Pick ONE of: an elegant proof of the main theorem, a surprising generalisation, a deep connection to another area of maths, or a harder non-trivial example that stretches the concept. Work through it fully. Clearly mark it as optional. Briefly recall any notation before using it.`;

    const userMsg = `Topic: ${topic}
ML context: ${sec.why}

The student needs to solve these exercises after reading the full lesson — make sure the examples and toolkit collectively cover every required technique:
${exList}`;

    try {
      const data = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 8000,
          system: sys,
          messages: [{ role: "user", content: userMsg }]
        })
      }).then(r => r.json());

      const text = data.content?.map(b => b.text).filter(Boolean).join("");
      if (!text) {
        const errMsg = data.error?.message || JSON.stringify(data.error || "Empty response");
        setExplanations(p => ({ ...p, [sec.id]: `⚠️ API error: ${errMsg}` }));
      } else {
        setExplanations(p => ({ ...p, [sec.id]: text }));
        try { await storage.set(`expl5-${sec.id}`, text); } catch(_) {}
      }
    } catch(e) {
      setExplanations(p => ({ ...p, [sec.id]: `⚠️ Network error: ${e.message}` }));
    } finally {
      setExplLoading(p => ({ ...p, [sec.id]: false }));
    }
  }

  function toggleDone(id) {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    try { localStorage.setItem("mml-done", JSON.stringify(next)); } catch(_) {}
  }

  const totalSecs = PLAN.reduce((a,c) => a + c.sections.length, 0);
  const doneSecs  = Object.values(done).filter(Boolean).length;
  const pct       = Math.round((doneSecs / totalSecs) * 100);
  const ch        = PLAN[selCh];
  const chDone    = ch.sections.filter(s => done[s.id]).length;
  const bg = "#1a1d21", surf = "#22262b", surf2 = "#262b31", bord = "#30363d",
        txt = "#e6edf3", muted = "#8b949e", ink = "#0d1117";
  const ringR = 15.5, ringC = 2 * Math.PI * ringR;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh",
                  background:`radial-gradient(1000px 560px at 10% -10%, ${ch.color}22, transparent 62%),
                              radial-gradient(800px 600px at 105% 8%, #58a6ff18, transparent 58%),
                              radial-gradient(700px 500px at 50% 115%, #f472b614, transparent 58%),
                              radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1.6px) 0 0/24px 24px,
                              ${bg}`,
                  color:txt, fontFamily:"'Inter',sans-serif", fontSize:13.5, overflow:"hidden" }}>

      {/* HEADER */}
      <div style={{ padding:"14px 24px", borderBottom:`1px solid ${bord}`, display:"flex",
                    alignItems:"center", justifyContent:"space-between", flexShrink:0,
                    background:"rgba(26,29,33,0.9)", boxShadow:"0 1px 0 rgba(255,255,255,0.04)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:10, display:"flex", alignItems:"center",
                        justifyContent:"center", flexShrink:0,
                        background:"linear-gradient(135deg, #f0a030, #f472b6, #60a5fa)",
                        boxShadow:"0 2px 10px -2px rgba(244,114,182,0.4)",
                        fontFamily:"'Lora',serif", fontWeight:700, fontSize:16, color:ink }}>
            Σ
          </div>
          <div>
            <div style={{ fontFamily:"'Lora',serif", fontSize:17, fontWeight:700, color:txt, lineHeight:1.2 }}>
              MML Study Planner
            </div>
            <div style={{ color:muted, fontSize:11, marginTop:1 }}>Mathematics for Machine Learning · Part I</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <span style={{ fontSize:11.5, color:muted }}>{doneSecs}/{totalSecs} sections</span>
          <div style={{ position:"relative", width:38, height:38, flexShrink:0 }}>
            <svg width={38} height={38} style={{ transform:"rotate(-90deg)" }}>
              <circle cx={19} cy={19} r={ringR} fill="none" stroke="#30363d" strokeWidth={4} />
              <circle cx={19} cy={19} r={ringR} fill="none"
                      stroke={pct===100 ? "#4ade80" : ch.color} strokeWidth={4} strokeLinecap="round"
                      strokeDasharray={ringC} strokeDashoffset={ringC * (1 - pct / 100)}
                      style={{ transition:"stroke-dashoffset .5s ease, stroke .3s ease",
                               filter: pct>0 ? `drop-shadow(0 0 3px ${pct===100?"#4ade80":ch.color}aa)` : "none" }} />
            </svg>
            <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
                           justifyContent:"center", fontSize:10, fontWeight:700,
                           fontFamily:"'JetBrains Mono',monospace",
                           color: pct===100?"#4ade80":ch.color }}>{pct}</span>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* SIDEBAR */}
        <div style={{ width:236, borderRight:`1px solid ${bord}`, overflowY:"auto",
                      padding:"16px 10px", flexShrink:0, background:"rgba(26,29,33,0.6)" }}>
          <div style={{ fontSize:10, color:muted, textTransform:"uppercase", letterSpacing:1.2,
                        padding:"0 10px 10px", fontWeight:600 }}>Chapters</div>
          {PLAN.map((c,i) => {
            const cDone = c.sections.filter(s => done[s.id]).length;
            const cPct  = Math.round((cDone/c.sections.length)*100);
            const active = i === selCh;
            const cComplete = cPct === 100;
            return (
              <button key={c.id} className="mml-nav-item" onClick={() => { setSelCh(i); setOpenSec(null); setReveal({}); }}
                style={{ display:"block", width:"100%", textAlign:"left", padding:"9px 11px",
                         borderRadius:9, marginBottom:3, border:"none", cursor:"pointer",
                         background: active ? `${c.color}1c` : "transparent" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:9 }}>
                  <div className="mml-badge" style={{ width:22, height:22, borderRadius:"50%", flexShrink:0,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:10, fontWeight:700, fontFamily:"'JetBrains Mono',monospace", marginTop:0,
                                background: active ? c.color : cComplete ? "#4ade8022" : `${c.color}1e`,
                                color: active ? ink : cComplete ? "#4ade80" : c.color,
                                boxShadow: active ? `0 0 0 3px ${c.color}30, 0 0 10px ${c.color}66` : "none",
                                transition:"transform .15s ease, box-shadow .15s ease" }}>
                    {cComplete ? "✓" : c.num}
                  </div>
                  <span style={{ flex:1, fontWeight:active?600:400, color:active?c.color:txt,
                                 fontSize:12.5, lineHeight:1.35, marginTop:1 }}>
                    {c.title}
                  </span>
                  <span style={{ fontSize:9.5, color:muted, fontFamily:"'JetBrains Mono',monospace",
                                 flexShrink:0, marginTop:3 }}>
                    {cDone}/{c.sections.length}
                  </span>
                </div>
                <div style={{ height:3, background:"#30363d", borderRadius:99, marginTop:7, marginLeft:31, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${cPct}%`,
                                background: cComplete ? "#4ade80" : c.color, borderRadius:99,
                                transition:"width .3s ease",
                                boxShadow: cPct>0 ? `0 0 6px ${cComplete?"#4ade80":c.color}88` : "none" }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* MAIN */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 28px" }}>
          <div style={{ marginBottom:22 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:6 }}>
              <span style={{ fontFamily:"'Lora',serif", fontSize:23, fontWeight:700, color:ch.color }}>
                {ch.num}. {ch.title}
              </span>
              <span style={{ fontSize:11.5, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>
                {chDone}/{ch.sections.length} done
              </span>
            </div>
            <div style={{ color:muted, fontSize:12.5, fontStyle:"italic", lineHeight:1.6 }}>{ch.tagline}</div>
            <div style={{ height:2, width:48, background:ch.color, borderRadius:99, marginTop:10, opacity:0.7 }} />
          </div>

          {ch.sections.map(sec => {
            const isOpen = openSec === sec.id;
            const isDone = !!done[sec.id];
            return (
              <div key={sec.id} className="mml-card" style={{ marginBottom:10, borderRadius:12, overflow:"hidden",
                                         border:`1px solid ${isOpen ? ch.color+"66" : bord}`, background:surf,
                                         boxShadow: isOpen
                                           ? `0 8px 24px -12px rgba(0,0,0,0.55), 0 0 0 1px ${ch.color}25`
                                           : "0 1px 2px rgba(0,0,0,0.25)",
                                         "--accent": ch.color }}>
                <button className="mml-nav-item" onClick={() => openSection(sec.id)}
                  style={{ display:"block", position:"relative", overflow:"hidden", width:"100%",
                           padding:"13px 16px", background: isOpen ? `${ch.color}10` : surf,
                           border:"none", cursor:"pointer", textAlign:"left" }}>
                  <span style={{ position:"absolute", right:10, top:-10, fontFamily:"'Lora',serif",
                                 fontWeight:700, fontSize:50, lineHeight:1, color:`${ch.color}16`,
                                 pointerEvents:"none", userSelect:"none" }}>
                    {sec.id.split(".")[1]}
                  </span>
                  <span style={{ position:"relative", zIndex:1, display:"flex", alignItems:"center" }}>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10.5, color:ch.color,
                                    marginRight:12, minWidth:30, fontWeight:600 }}>§{sec.id}</span>
                    <span style={{ flex:1, fontWeight:500, color:txt, fontSize:13.5 }}>{sec.title}</span>
                    <span style={{ fontSize:10.5, color:muted, marginRight:12 }}>pp. {sec.pages}</span>
                    {isDone && <span style={{ fontSize:10, color:"#4ade80", marginRight:10 }}>✓</span>}
                    <span className="mml-chevron" style={{ color:muted, fontSize:11,
                                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                  </span>
                </button>

                {isOpen && (
                  <div className="mml-reveal" style={{ padding:"18px 20px", background:surf2, borderTop:`1px solid ${bord}` }}>
                    <div style={{ background:`${ch.color}10`, border:`1px solid ${ch.color}28`,
                                  borderRadius:8, padding:"9px 13px", marginBottom:16,
                                  fontSize:12.5, color:txt, lineHeight:1.65 }}>
                      <span style={{ color:ch.color, fontWeight:600, fontSize:10 }}>↳ ML RELEVANCE&nbsp;</span>
                      <T>{sec.why}</T>
                    </div>

                    {/* ── THEORY ─────────────────────────────────────── */}
                    <div style={{ marginBottom:18 }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                                    marginBottom:8 }}>
                        <span style={{ fontSize:10.5, color:muted, textTransform:"uppercase",
                                       letterSpacing:0.8, fontWeight:600 }}>Theory</span>
                        <div style={{ display:"flex", gap:6 }}>
                          {!STATIC_DEPLOY && !explLoading[sec.id] && !explanations[sec.id] && (
                            <button className="mml-btn" onClick={() => fetchExpl(sec, ch)}
                              style={{ padding:"4px 12px", borderRadius:99, fontSize:10.5, fontWeight:600,
                                       background:`${ch.color}22`, color:ch.color,
                                       border:`1px solid ${ch.color}50`, cursor:"pointer" }}>
                              ✦ Generate
                            </button>
                          )}
                          {!STATIC_DEPLOY && !explLoading[sec.id] && explanations[sec.id] && (
                            <button className="mml-btn" onClick={() => fetchExpl(sec, ch)}
                              style={{ padding:"4px 10px", borderRadius:99, fontSize:10.5,
                                       background:"transparent", color:muted,
                                       border:`1px solid ${bord}`, cursor:"pointer" }}>
                              ↺ Redo
                            </button>
                          )}
                        </div>
                      </div>
                      {explLoading[sec.id] && (
                        <div style={{ padding:"16px", background:surf, borderRadius:8,
                                      border:`1px solid ${bord}`, color:muted, fontSize:11.5,
                                      fontStyle:"italic", textAlign:"center" }}>
                          <span className="mml-pulse">Generating explanation…</span>
                        </div>
                      )}
                      {!explLoading[sec.id] && explanations[sec.id] && (
                        <div style={{ padding:"16px 18px", background:surf,
                                      border:`1px solid ${ch.color}30`, borderRadius:8 }}>
                          <ExplRenderer content={explanations[sec.id]} color={ch.color} k={k} />
                        </div>
                      )}
                      {!explLoading[sec.id] && !explanations[sec.id] && (
                        <div style={{ padding:"12px 16px", background:`${surf}99`,
                                      border:`1px dashed ${bord}`, borderRadius:8,
                                      fontSize:11.5, color:muted, fontStyle:"italic" }}>
                          {STATIC_DEPLOY
                            ? "No explanation cached for this section yet."
                            : "Click ✦ Generate for an AI explanation with definitions, key results, worked example, and ML connection."}
                        </div>
                      )}
                    </div>

                    {/* ── PYTHON ─────────────────────────────────────── */}
                    {sec.py && (
                      <div style={{ marginBottom:18 }}>
                        <div style={{ fontSize:10.5, color:muted, textTransform:"uppercase",
                                      letterSpacing:0.8, fontWeight:600, marginBottom:8 }}>In Python</div>
                        <div style={{ padding:"16px 18px", background:surf,
                                      border:`1px solid ${ch.color}30`, borderRadius:8 }}>
                          <ExplRenderer content={sec.py} color={ch.color} k={k} />
                        </div>
                      </div>
                    )}

                    {/* ── RESOURCES ───────────────────────────────────── */}
                    <div style={{ marginBottom:16 }}>
                      <div style={{ fontSize:10.5, color:muted, textTransform:"uppercase",
                                    letterSpacing:0.8, fontWeight:600, marginBottom:8 }}>Resources</div>
                      {sec.resources.map((r,i) => (
                        <a key={i} className="mml-link" href={r.url} target="_blank" rel="noreferrer"
                           style={{ display:"block", color:ch.color, fontSize:12.5,
                                    textDecoration:"none", marginBottom:5 }}>↗ {r.name}</a>
                      ))}
                    </div>

                    <div>
                      <div style={{ fontSize:10.5, color:muted, textTransform:"uppercase",
                                    letterSpacing:0.8, fontWeight:600, marginBottom:12 }}>
                        Practice Exercises ({sec.exs.length})
                      </div>
                      {sec.exs.map((ex, ei) => {
                        const key = `${sec.id}-${ei}`;
                        const rv  = reveal[key] || {};
                        const h   = hints[sec.id]?.[ei];
                        const hLoading = hintsLoading[sec.id];
                        return (
                          <div key={ei} style={{ marginBottom:18, paddingLeft:13,
                                                  borderLeft:`2px solid ${ch.color}35` }}>
                            <div style={{ display:"flex", justifyContent:"space-between",
                                          alignItems:"center", marginBottom:6 }}>
                              <span style={{ fontFamily:"'JetBrains Mono',monospace",
                                             fontSize:10, color:muted, background:`${ch.color}15`,
                                             padding:"2px 7px", borderRadius:99 }}>Ex {ei+1}</span>
                              <span style={{ fontSize:10.5, color:`${ch.color}aa`, fontStyle:"italic" }}>
                                {ex.ref}
                              </span>
                            </div>
                            <div style={{ fontSize:13, color:txt, lineHeight:1.8, marginBottom:9 }}>
                              <T>{ex.q}</T>
                            </div>
                            <textarea
                              className="mml-textarea"
                              placeholder="Write your answer here…"
                              value={answers[key] || ""}
                              onChange={e => setAnswers(p => ({...p, [key]:e.target.value}))}
                              style={{ width:"100%", minHeight:68, padding:"9px 11px",
                                       background:"#0d1117", border:`1px solid ${bord}`,
                                       borderRadius:7, color:txt, fontSize:12.5,
                                       fontFamily:"'Inter',sans-serif", resize:"vertical",
                                       boxSizing:"border-box", outline:"none", lineHeight:1.55,
                                       "--accent": ch.color }}
                            />

                            {!STATIC_DEPLOY && !h && !hLoading && (
                              <button className="mml-btn" onClick={() => fetchHints(sec)}
                                style={{ marginTop:7, padding:"5px 13px", borderRadius:99,
                                         background:`${ch.color}22`, color:ch.color,
                                         border:`1px solid ${ch.color}50`, cursor:"pointer",
                                         fontSize:11.5, fontWeight:600 }}>
                                ✦ Generate hints
                              </button>
                            )}
                            {hLoading && (
                              <span className="mml-pulse" style={{ fontSize:11.5, color:muted, fontStyle:"italic" }}>
                                Generating hints…
                              </span>
                            )}

                            {h && (
                              <div style={{ marginTop:8, display:"flex", gap:6 }}>
                                <button className="mml-btn" onClick={() => toggleReveal(sec.id, ei, "h1")}
                                  style={{ padding:"5px 13px", borderRadius:99, fontSize:11.5, fontWeight:600,
                                           background: rv.h1 ? `${ch.color}15` : "transparent",
                                           color: ch.color, border:`1px solid ${ch.color}50`, cursor:"pointer" }}>
                                  Hint 1
                                </button>
                                <button className="mml-btn" onClick={() => toggleReveal(sec.id, ei, "h2")}
                                  style={{ padding:"5px 13px", borderRadius:99, fontSize:11.5, fontWeight:600,
                                           background: rv.h2 ? `${ch.color}15` : "transparent",
                                           color: ch.color, border:`1px solid ${ch.color}50`, cursor:"pointer" }}>
                                  Hint 2
                                </button>
                                <button className="mml-btn" onClick={() => toggleReveal(sec.id, ei, "ans")}
                                  style={{ padding:"5px 13px", borderRadius:99, fontSize:11.5, fontWeight:600,
                                           background: rv.ans ? "#4ade8018" : `linear-gradient(135deg, ${ch.color}, ${ch.color}cc)`,
                                           color: rv.ans ? "#4ade80" : ink,
                                           border: rv.ans ? "1px solid #4ade8050" : "none", cursor:"pointer" }}>
                                  Show Answer
                                </button>
                              </div>
                            )}

                            {h && rv.h1 && (
                              <div className="mml-reveal" style={{ marginTop:9, padding:"10px 13px",
                                            background:`${ch.color}10`, border:`1px solid ${ch.color}28`,
                                            borderRadius:7, fontSize:12.5, color:txt, lineHeight:1.7 }}>
                                <span style={{ color:ch.color, fontWeight:600, fontSize:10.5 }}>💡 Hint 1&nbsp;</span>
                                <T>{h.hint1}</T>
                              </div>
                            )}
                            {h && rv.h2 && (
                              <div className="mml-reveal" style={{ marginTop:7, padding:"10px 13px",
                                            background:`${ch.color}10`, border:`1px solid ${ch.color}28`,
                                            borderRadius:7, fontSize:12.5, color:txt, lineHeight:1.7 }}>
                                <span style={{ color:ch.color, fontWeight:600, fontSize:10.5 }}>💡 Hint 2&nbsp;</span>
                                <T>{h.hint2}</T>
                              </div>
                            )}
                            {h && rv.ans && (
                              <div className="mml-reveal" style={{ marginTop:7, padding:"12px 14px",
                                            background:surf, border:`1px solid #4ade8030`,
                                            borderRadius:7 }}>
                                <span style={{ color:"#4ade80", fontWeight:600, fontSize:10.5 }}>✓ Answer</span>
                                <ExplRenderer content={h.answer} color={ch.color} k={k} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ marginTop:16, paddingTop:14, borderTop:`1px solid ${bord}`,
                                  display:"flex", justifyContent:"flex-end" }}>
                      <button className={isDone ? "mml-btn mml-pop" : "mml-btn"} onClick={() => toggleDone(sec.id)}
                        style={{ padding:"6px 16px", borderRadius:99, fontSize:12.5, fontWeight:600,
                                 border:`1px solid ${isDone?"#4ade80":ch.color}`,
                                 background: isDone?"#4ade8018":`${ch.color}15`,
                                 color: isDone?"#4ade80":ch.color, cursor:"pointer" }}>
                        {isDone ? "✓ Completed" : "Mark as complete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {ch.furtherReading && (
            <div style={{ marginTop:22, padding:"16px 18px", borderRadius:12,
                          background:surf, border:`1px solid ${bord}`,
                          boxShadow:"0 1px 2px rgba(0,0,0,0.2)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
                            marginBottom:10 }}>
                <span style={{ fontSize:10.5, color:muted, textTransform:"uppercase",
                               letterSpacing:0.8, fontWeight:600 }}>Further Reading</span>
                <span style={{ fontSize:10.5, color:muted, fontFamily:"'JetBrains Mono',monospace" }}>{ch.frRef}</span>
              </div>
              <div style={{ fontSize:13, color:txt, lineHeight:1.75 }}>
                <T>{ch.furtherReading}</T>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
