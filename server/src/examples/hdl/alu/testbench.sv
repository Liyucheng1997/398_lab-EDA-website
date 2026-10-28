`timescale 1ns / 1ps

// ALU 测试：定向用例 + 每种操作 200 组 $random 随机用例，与行为级参考模型比对
module tb;
  import alu_pkg::*;

  logic [7:0] a, b, y;
  alu_op_t    op;
  logic       zero, carry, overflow;
  integer     errors = 0;
  integer     tests  = 0;

  alu dut (.a(a), .b(b), .op(op), .y(y), .zero(zero), .carry(carry), .overflow(overflow));

  // 行为级参考模型
  function automatic logic [7:0] ref_y(input alu_op_t o, input logic [7:0] x, input logic [7:0] z);
    case (o)
      ALU_ADD: ref_y = x + z;
      ALU_SUB: ref_y = x - z;
      ALU_AND: ref_y = x & z;
      ALU_OR:  ref_y = x | z;
      ALU_XOR: ref_y = x ^ z;
      ALU_SLT: ref_y = ($signed(x) < $signed(z)) ? 8'd1 : 8'd0;
      ALU_SLL: ref_y = x << z[2:0];
      default: ref_y = x >> z[2:0];
    endcase
  endfunction

  task automatic apply(input alu_op_t o, input logic [7:0] x, input logic [7:0] z);
    logic [7:0] expect_y;
    logic [8:0] wide;
    op = o;
    a  = x;
    b  = z;
    #5;
    tests = tests + 1;
    expect_y = ref_y(o, x, z);
    if (y !== expect_y || zero !== (expect_y == 0)) begin
      $display("错误：op=%0d a=%0d b=%0d -> y=%0d，期望 %0d", o, x, z, y, expect_y);
      errors = errors + 1;
    end
    if (o == ALU_ADD) begin
      wide = {1'b0, x} + {1'b0, z};
      if (carry !== wide[8]) begin
        $display("错误：%0d + %0d 进位 = %b", x, z, carry);
        errors = errors + 1;
      end
    end
  endtask

  initial begin
    integer  k;
    alu_op_t o;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    // 定向用例
    apply(ALU_ADD, 8'd200, 8'd100);   // 进位
    apply(ALU_ADD, 8'd127, 8'd1);     // 有符号溢出
    if (overflow !== 1'b1) begin $display("错误：127+1 应溢出"); errors = errors + 1; end
    apply(ALU_SUB, 8'd5, 8'd5);       // 结果为 0
    apply(ALU_SLT, 8'hFF, 8'd1);      // -1 < 1
    apply(ALU_SLT, 8'd1, 8'hFF);      // 1 < -1 为假
    apply(ALU_SLL, 8'b0000_0011, 8'd4);
    apply(ALU_SRL, 8'b1100_0000, 8'd6);

    // 随机用例：用枚举的 .next() 方法轮流遍历 8 种操作
    o = o.first();
    for (k = 0; k < 8 * 200; k = k + 1) begin
      apply(o, $random, $random);
      o = o.next();
    end

    if (errors == 0) $display("PASS: %0d 组 ALU 用例全部正确", tests);
    else             $display("FAIL: %0d/%0d 组用例出错", errors, tests);
    $finish;
  end
endmodule
