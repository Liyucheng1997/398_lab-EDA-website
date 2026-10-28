`timescale 1ns / 1ps

// 两个「控制器 + 数据通路」（FSMD）的经典例子：
//   gcd       —— 辗转相减法求最大公约数
//   fibonacci —— 迭代计算第 n 个斐波那契数
// 接口都采用 start / busy / done 握手：start 拉高一拍启动，done 拉高一拍表示结果有效。

module gcd #(
  parameter W = 16
) (
  input  logic         clk,
  input  logic         rst,
  input  logic         start,
  input  logic [W-1:0] a_in,
  input  logic [W-1:0] b_in,
  output logic         busy,
  output logic         done,
  output logic [W-1:0] result
);
  typedef enum logic [1:0] {IDLE = 2'd0, CALC = 2'd1, FINISH = 2'd2} state_t;

  state_t       state;
  logic [W-1:0] a, b;

  always_ff @(posedge clk) begin
    if (rst) begin
      state  <= IDLE;
      a      <= '0;
      b      <= '0;
      done   <= 1'b0;
      result <= '0;
    end else begin
      done <= 1'b0;
      case (state)
        IDLE: if (start) begin
          a     <= a_in;
          b     <= b_in;
          state <= CALC;
        end
        CALC: begin
          // 数据通路：比较器 + 减法器
          if (a == '0 || b == '0) begin   // gcd(x, 0) = x
            result <= a | b;
            state  <= FINISH;
          end else if (a == b) begin
            result <= a;
            state  <= FINISH;
          end else if (a > b) begin
            a <= a - b;
          end else begin
            b <= b - a;
          end
        end
        default: begin  // FINISH
          done  <= 1'b1;
          state <= IDLE;
        end
      endcase
    end
  end

  assign busy = (state != IDLE);
endmodule

module fibonacci #(
  parameter W = 32
) (
  input  logic         clk,
  input  logic         rst,
  input  logic         start,
  input  logic [5:0]   n,       // 计算 F(n)，F(0) = 0，F(1) = 1
  output logic         busy,
  output logic         done,
  output logic [W-1:0] result
);
  logic         running;
  logic [5:0]   count;
  logic [W-1:0] f0, f1;   // 当前的 F(k) 与 F(k+1)

  always_ff @(posedge clk) begin
    if (rst) begin
      running <= 1'b0;
      done    <= 1'b0;
      count   <= '0;
      f0      <= '0;
      f1      <= '0;
      result  <= '0;
    end else begin
      done <= 1'b0;
      if (!running) begin
        if (start) begin
          f0      <= '0;
          f1      <= {{(W-1){1'b0}}, 1'b1};
          count   <= n;
          running <= 1'b1;
        end
      end else if (count == 6'd0) begin
        result  <= f0;
        done    <= 1'b1;
        running <= 1'b0;
      end else begin
        f0    <= f1;
        f1    <= f0 + f1;
        count <= count - 6'd1;
      end
    end
  end

  assign busy = running;
endmodule
