`timescale 1ns / 1ps

// 半加器：两个 1 位数相加，输出和 s 与进位 c
module half_adder (
  input  logic a,
  input  logic b,
  output logic s,
  output logic c
);
  assign s = a ^ b;
  assign c = a & b;
endmodule

// 全加器：由两个半加器 + 一个或门构成（结构化描述）
module full_adder (
  input  logic a,
  input  logic b,
  input  logic cin,
  output logic s,
  output logic cout
);
  logic s1, c1, c2;

  half_adder ha0 (.a(a),  .b(b),   .s(s1), .c(c1));
  half_adder ha1 (.a(s1), .b(cin), .s(s),  .c(c2));

  assign cout = c1 | c2;
endmodule
