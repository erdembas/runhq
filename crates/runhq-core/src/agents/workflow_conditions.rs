//! Small bounded grammar, never JavaScript or shell evaluation.
use super::*;
#[derive(Clone)]
pub(super) struct StepState {
    pub status: String,
    pub verdict: Option<String>,
    pub runs: u32,
}
#[derive(Clone, Debug, PartialEq)]
enum Token {
    Ref(String, String),
    Text(String),
    Number(u32),
    Not,
    And,
    Or,
    Eq,
    Ne,
    Ge,
    Gt,
    Le,
    Lt,
    L,
    R,
}
#[derive(Clone, Debug)]
enum Expr {
    Compare(Token, Token, Token),
    Not(Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Or(Box<Expr>, Box<Expr>),
}
fn tokens(source: &str) -> AppResult<Vec<Token>> {
    if source.len() > 4096 {
        return Err(invalid("workflow.invalid_condition"));
    }
    let mut rest = source;
    let mut out = vec![];
    while !rest.trim_start().is_empty() {
        if out.len() >= 256 {
            return Err(invalid("workflow.invalid_condition"));
        }
        rest = rest.trim_start();
        let mut symbol = false;
        for (s, t) in [
            ("&&", Token::And),
            ("||", Token::Or),
            ("==", Token::Eq),
            ("!=", Token::Ne),
            (">=", Token::Ge),
            ("<=", Token::Le),
            ("!", Token::Not),
            (">", Token::Gt),
            ("<", Token::Lt),
            ("(", Token::L),
            (")", Token::R),
        ] {
            if let Some(r) = rest.strip_prefix(s) {
                out.push(t);
                rest = r;
                symbol = true;
                break;
            }
        }
        if symbol {
            continue;
        }
        if let Some(r) = rest.strip_prefix('\'') {
            let end = r
                .find('\'')
                .ok_or_else(|| invalid("workflow.invalid_condition"))?;
            let text = &r[..end];
            if !["PASS", "CONDITIONAL", "FAIL"].contains(&text) {
                return Err(invalid("workflow.invalid_condition"));
            }
            out.push(Token::Text(text.into()));
            rest = &r[end + 1..];
            continue;
        }
        let n = rest
            .bytes()
            .take_while(|c| c.is_ascii_alphanumeric() || b"-_.".contains(c))
            .count();
        if n == 0 {
            return Err(invalid("workflow.invalid_condition"));
        }
        let word = &rest[..n];
        rest = &rest[n..];
        if let Ok(n) = word.parse::<u32>() {
            out.push(Token::Number(n));
        } else if let Some((id, field)) = word.rsplit_once('.') {
            if !["verdict", "runCount"].contains(&field) {
                return Err(invalid("workflow.invalid_condition"));
            }
            out.push(Token::Ref(id.into(), field.into()));
        } else {
            return Err(invalid("workflow.invalid_condition"));
        }
        if out.len() > 256 {
            return Err(invalid("workflow.invalid_condition"));
        }
    }
    Ok(out)
}
fn parse(ts: &[Token], at: &mut usize, level: u32, min: u8) -> AppResult<Expr> {
    if level > 32 {
        return Err(invalid("workflow.invalid_condition"));
    }
    let mut left = match ts.get(*at) {
        Some(Token::Not) => {
            *at += 1;
            Expr::Not(Box::new(parse(ts, at, level + 1, 3)?))
        }
        Some(Token::L) => {
            *at += 1;
            let e = parse(ts, at, level + 1, 0)?;
            if ts.get(*at) != Some(&Token::R) {
                return Err(invalid("workflow.invalid_condition"));
            }
            *at += 1;
            e
        }
        Some(Token::Ref(_, field)) => {
            let a = ts[*at].clone();
            let op = ts
                .get(*at + 1)
                .cloned()
                .ok_or_else(|| invalid("workflow.invalid_condition"))?;
            let b = ts
                .get(*at + 2)
                .cloned()
                .ok_or_else(|| invalid("workflow.invalid_condition"))?;
            let valid = matches!(
                (&op, &b, field.as_str()),
                (Token::Eq | Token::Ne, Token::Text(_), "verdict")
                    | (
                        Token::Eq | Token::Ne | Token::Ge | Token::Gt | Token::Le | Token::Lt,
                        Token::Number(_),
                        "runCount",
                    )
            );
            if !valid {
                return Err(invalid("workflow.invalid_condition"));
            }
            *at += 3;
            Expr::Compare(a, op, b)
        }
        _ => return Err(invalid("workflow.invalid_condition")),
    };
    loop {
        let p = match ts.get(*at) {
            Some(Token::Or) => 1,
            Some(Token::And) => 2,
            _ => break,
        };
        if p < min {
            break;
        }
        let op = ts[*at].clone();
        *at += 1;
        let right = parse(ts, at, level + 1, p + 1)?;
        left = if op == Token::And {
            Expr::And(Box::new(left), Box::new(right))
        } else {
            Expr::Or(Box::new(left), Box::new(right))
        };
    }
    Ok(left)
}
fn expression(source: &str) -> AppResult<Expr> {
    let ts = tokens(source)?;
    let mut at = 0;
    let e = parse(&ts, &mut at, 0, 0)?;
    if at != ts.len() {
        return Err(invalid("workflow.invalid_condition"));
    }
    Ok(e)
}
fn evaluate(e: &Expr, states: &std::collections::BTreeMap<String, StepState>) -> Option<bool> {
    match e {
        Expr::Not(x) => evaluate(x, states).map(|v| !v),
        Expr::And(a, b) => match (evaluate(a, states), evaluate(b, states)) {
            (Some(false), _) | (_, Some(false)) => Some(false),
            (Some(true), Some(true)) => Some(true),
            _ => None,
        },
        Expr::Or(a, b) => match (evaluate(a, states), evaluate(b, states)) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), Some(false)) => Some(false),
            _ => None,
        },
        Expr::Compare(Token::Ref(id, field), op, value) => {
            let s = states.get(id)?;
            if s.status != "completed" {
                return None;
            }
            if field == "verdict" {
                let equal = s.verdict.as_ref()?
                    == match value {
                        Token::Text(t) => t,
                        _ => return None,
                    };
                Some(if *op == Token::Eq { equal } else { !equal })
            } else {
                let Token::Number(n) = value else {
                    return None;
                };
                Some(match op {
                    Token::Eq => s.runs == *n,
                    Token::Ne => s.runs != *n,
                    Token::Ge => s.runs >= *n,
                    Token::Gt => s.runs > *n,
                    Token::Le => s.runs <= *n,
                    Token::Lt => s.runs < *n,
                    _ => return None,
                })
            }
        }
        _ => None,
    }
}
pub(super) fn condition(
    source: &str,
    states: &std::collections::BTreeMap<String, StepState>,
) -> AppResult<Option<bool>> {
    if source.is_empty() {
        return Ok(Some(true));
    }
    Ok(evaluate(&expression(source)?, states))
}
pub(super) fn references(source: &str) -> AppResult<Vec<String>> {
    if source.is_empty() {
        return Ok(vec![]);
    }
    expression(source)?;
    Ok(tokens(source)?
        .into_iter()
        .filter_map(|t| {
            if let Token::Ref(id, _) = t {
                Some(id)
            } else {
                None
            }
        })
        .collect())
}
