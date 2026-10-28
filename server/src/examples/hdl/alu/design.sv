`timescale 1ns / 1ps

// 操作码放在 package 中，设计与测试平台共享同一份定义
package alu_pkg;
  typedef enum logic [2:0] {
    ALU_ADD = 3'd0,  // y = a + b
    ALU_SUB = 3'd1,  // y = a - b
    ALU_AND = 3'd2,  // y = a & b
    ALU_OR  = 3'd3,  // y = a | b
    ALU_XOR = 3'd4,  // y = a ^ b
    ALU_SLT = 3'd5,  // y = (有符号 a < b) ? 1 : 0
    ALU_SLL = 3'd6,  // y = a << b[2:0]
    ALU_SRL = 3'd7   // y = a >> b[2:0]
  } alu_op_t;
endpackage

// 1 位全加器
module full_adder (
  input  logic a, b, cin,
  output logic s, cout
);
  assign s    = a ^ b ^ cin;
  assign cout = (a & b) | (cin & (a ^ b));
endmodule

// N 位行波进位加法器：用 generate 串联 N 个全加器
module ripple_carry_adder #(
  parameter N = 8
) (
  input  logic [N-1:0] a,
  input  logic [N-1:0] b,
  input  logic         cin,
  output logic [N-1:0] sum,
  output logic         cout
);
  logic [N:0] c;
  assign c[0] = cin;

  genvar i;
  generate
    for (i = 0; i < N; i = i + 1) begin : g_bit
      full_adder fa (.a(a[i]), .b(b[i]), .cin(c[i]), .s(sum[i]), .cout(c[i+1]));
    end
  endgenerate

  assign cout = c[N];
endmodule

// 8 位 ALU：加减法复用同一个行波进位加法器（减法 = a + ~b + 1）
module alu (
  input  logic [7:0]       a,
  input  logic [7:0]       b,
  input  alu_pkg::alu_op_t op,
  output logic [7:0]       y,
  output logic             zero,      // y == 0
  output logic             carry,     // 加法进位 / 减法无借位
  output logic             overflow   // 有符号溢出（仅加减法有效）
);
  logic       is_sub;
  logic [7:0] b_eff, sum;
  logic       cout;
  logic [2:0] shamt;
  logic       a_msb, b_msb, s_msb;

  assign is_sub = (op == alu_pkg::ALU_SUB) || (op == alu_pkg::ALU_SLT);
  assign b_eff  = is_sub ? ~b : b;
  assign shamt  = b[2:0];
  assign a_msb  = a[7];
  assign b_msb  = b_eff[7];
  assign s_msb  = sum[7];

  ripple_carry_adder #(.N(8)) adder (.a(a), .b(b_eff), .cin(is_sub), .sum(sum), .cout(cout));

  // 有符号溢出：两个同号数相加得到异号结果
  assign overflow = (a_msb == b_msb) && (s_msb != a_msb);

  // 用 包名::枚举值 引用操作码（Yosys 不支持在模块内部 import）
  always_comb begin
    case (op)
      alu_pkg::ALU_ADD,
      alu_pkg::ALU_SUB: y = sum;
      alu_pkg::ALU_AND: y = a & b;
      alu_pkg::ALU_OR:  y = a | b;
      alu_pkg::ALU_XOR: y = a ^ b;
      alu_pkg::ALU_SLT: y = {7'd0, s_msb ^ overflow};  // 有符号比较 = 差的符号位 ^ 溢出
      alu_pkg::ALU_SLL: y = a << shamt;
      alu_pkg::ALU_SRL: y = a >> shamt;
      default:          y = 8'd0;
    endcase
  end

  assign zero  = (y == 8'd0);
  assign carry = cout;
endmodule
